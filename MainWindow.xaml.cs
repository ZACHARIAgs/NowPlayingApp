using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace NowPlayingApp
{
    public partial class MainWindow : Window
    {
        private MediaManager _mediaManager;
        private bool _isFullScreen = false;
        private WindowState _previousWindowState;
        private CancellationTokenSource? _marqueeCts;

        [DllImport("dwmapi.dll", PreserveSig = true)]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);
        private const int DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19;
        private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

        public MainWindow()
        {
            InitializeComponent();
            _mediaManager = new MediaManager();
            _mediaManager.OnMediaChanged += MediaManager_OnMediaChanged;
            
            Loaded += async (s, e) => {
                ApplyDarkTitleBar();
                StartBackgroundSpin();
                await _mediaManager.InitializeAsync();
            };
        }

        private void ApplyDarkTitleBar()
        {
            try
            {
                IntPtr hwnd = new WindowInteropHelper(this).Handle;
                int useImmersiveDarkMode = 1;
                int result = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref useImmersiveDarkMode, sizeof(int));
                if (result != 0)
                {
                    DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1, ref useImmersiveDarkMode, sizeof(int));
                }
            }
            catch { }
        }

        private double _backgroundAngle = 0;
        private DateTime _lastFrameTime = DateTime.UtcNow;
        private System.Windows.Threading.DispatcherTimer _spinTimer;

        private void StartBackgroundSpin()
        {
            _lastFrameTime = DateTime.UtcNow;
            _spinTimer = new System.Windows.Threading.DispatcherTimer();
            // 30 FPS ambient background rotation timer
            _spinTimer.Interval = TimeSpan.FromMilliseconds(33);
            _spinTimer.Tick += (s, e) =>
            {
                var now = DateTime.UtcNow;
                double deltaSeconds = (now - _lastFrameTime).TotalSeconds;
                _lastFrameTime = now;

                if (deltaSeconds > 0.1) deltaSeconds = 0.1;

                double maxDimension = Math.Max(this.ActualWidth, this.ActualHeight);
                if (maxDimension <= 0) return;

                double baseSpeed = 4.5;
                double ratio = 1000.0 / maxDimension;
                double blendedRatio = 0.5 + (0.5 * ratio);
                double angularSpeedDegPerSec = baseSpeed * blendedRatio;

                _backgroundAngle += angularSpeedDegPerSec * deltaSeconds;
                if (_backgroundAngle >= 360) _backgroundAngle -= 360;

                BackgroundRotate.Angle = _backgroundAngle;
            };
            _spinTimer.Start();
        }

        private RenderTargetBitmap CreateBlurredBackground(BitmapSource source)
        {
            // Creates an isolated visual image in memory
            var img = new Image
            {
                Source = source,
                Width = 200,
                Height = 200,
                Stretch = Stretch.UniformToFill
            };
            // Apply the expensive blur effect ONCE offline
            img.Effect = new System.Windows.Media.Effects.BlurEffect { Radius = 10, RenderingBias = System.Windows.Media.Effects.RenderingBias.Performance };
            img.Measure(new Size(200, 200));
            img.Arrange(new Rect(0, 0, 200, 200));

            // Rasterize the fully blurred image to a locked texture
            var rtb = new RenderTargetBitmap(200, 200, 96, 96, PixelFormats.Pbgra32);
            rtb.Render(img);
            rtb.Freeze();
            return rtb;
        }

        private void MediaManager_OnMediaChanged(object? sender, MediaPlaybackInfo e)
        {
            Dispatcher.Invoke(() =>
            {
                string title = string.IsNullOrEmpty(e.Title) ? "Waiting for media..." : e.Title;
                string artist = e.Artist ?? "";

                TitleText1.Text = title;
                TitleText2.Text = title;
                ArtistText1.Text = artist;
                ArtistText2.Text = artist;
                
                if (e.Thumbnail != null)
                {
                    AlbumArtImage.Source = e.Thumbnail;
                    // Cache the pre-blurred rendering ONCE when the song changes
                    BackgroundImage.Source = CreateBlurredBackground(e.Thumbnail);
                }
                else
                {
                    AlbumArtImage.Source = null;
                    BackgroundImage.Source = null;
                }

                TitleText1.UpdateLayout();
                ArtistText1.UpdateLayout();
                RestartMarquees();
            });
        }

        private void Containers_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            RestartMarquees();
        }

        private void Window_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            double maxDimension = Math.Max(this.ActualWidth, this.ActualHeight);
            if (maxDimension <= 0) return;

            double targetSize = maxDimension * 1.5;

            // Direct pixel resolution stretching
            BackgroundImage.Width = targetSize;
            BackgroundImage.Height = targetSize;

            Canvas.SetLeft(BackgroundImage, -targetSize / 2);
            Canvas.SetTop(BackgroundImage, -targetSize / 2);
        }

        private void RestartMarquees()
        {
            _marqueeCts?.Cancel();
            _marqueeCts = new CancellationTokenSource();
            
            Dispatcher.BeginInvoke(new Action(() => 
            {
                _ = RunSynchronizedMarqueeLoopAsync(_marqueeCts.Token);
            }), System.Windows.Threading.DispatcherPriority.Loaded);
        }

        private async Task RunSynchronizedMarqueeLoopAsync(CancellationToken token)
        {
            try
            {
                while (!token.IsCancellationRequested)
                {
                    Canvas.SetLeft(TitleText1, 0);
                    Canvas.SetLeft(ArtistText1, 0);
                    TitleText2.Visibility = Visibility.Hidden;
                    ArtistText2.Visibility = Visibility.Hidden;

                    bool titleNeedsScroll = TitleText1.ActualWidth > TitleCanvas.ActualWidth && TitleCanvas.ActualWidth > 0;
                    bool artistNeedsScroll = ArtistText1.ActualWidth > ArtistCanvas.ActualWidth && ArtistCanvas.ActualWidth > 0;

                    double gap = 60.0;
                    double titleTotalWidth = TitleText1.ActualWidth + gap;
                    double artistTotalWidth = ArtistText1.ActualWidth + gap;

                    if (titleNeedsScroll)
                    {
                        TitleText2.Visibility = Visibility.Visible;
                        Canvas.SetLeft(TitleText2, titleTotalWidth);
                    }

                    if (artistNeedsScroll)
                    {
                        ArtistText2.Visibility = Visibility.Visible;
                        Canvas.SetLeft(ArtistText2, artistTotalWidth);
                    }

                    if (titleNeedsScroll || artistNeedsScroll)
                    {
                        await Task.Delay(5000, token); // Pause for 5s at the beginning

                        double currentTitleX = 0;
                        double currentArtistX = 0;
                        double speedPerFrame = 0.8; 

                        bool titleScrolling = titleNeedsScroll;
                        bool artistScrolling = artistNeedsScroll;

                        while (titleScrolling || artistScrolling)
                        {
                            token.ThrowIfCancellationRequested();

                            if (titleScrolling)
                            {
                                currentTitleX -= speedPerFrame;
                                if (currentTitleX <= -titleTotalWidth)
                                {
                                    currentTitleX = 0;
                                    titleScrolling = false;
                                    Canvas.SetLeft(TitleText1, 0);
                                    TitleText2.Visibility = Visibility.Hidden;
                                }
                                else
                                {
                                    Canvas.SetLeft(TitleText1, currentTitleX);
                                    Canvas.SetLeft(TitleText2, currentTitleX + titleTotalWidth);
                                }
                            }

                            if (artistScrolling)
                            {
                                currentArtistX -= speedPerFrame;
                                if (currentArtistX <= -artistTotalWidth)
                                {
                                    currentArtistX = 0;
                                    artistScrolling = false;
                                    Canvas.SetLeft(ArtistText1, 0);
                                    ArtistText2.Visibility = Visibility.Hidden;
                                }
                                else
                                {
                                    Canvas.SetLeft(ArtistText1, currentArtistX);
                                    Canvas.SetLeft(ArtistText2, currentArtistX + artistTotalWidth);
                                }
                            }

                            await Task.Delay(16, token);
                        }
                    }
                    else
                    {
                        await Task.Delay(-1, token);
                    }
                }
            }
            catch (OperationCanceledException) { }
        }

        private void MinimizeButton_Click(object sender, RoutedEventArgs e)
        {
            this.WindowState = WindowState.Minimized;
        }

        private void MaximizeButton_Click(object sender, RoutedEventArgs e)
        {
            if (this.WindowState == WindowState.Maximized)
                this.WindowState = WindowState.Normal;
            else
                this.WindowState = WindowState.Maximized;
        }

        private void CloseButton_Click(object sender, RoutedEventArgs e)
        {
            this.Close();
        }

        private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.F11)
            {
                ToggleFullScreen();
                e.Handled = true;
            }
            else if (e.Key == Key.Escape && _isFullScreen)
            {
                ToggleFullScreen();
                e.Handled = true;
            }
        }

        private void ToggleFullScreen()
        {
            _isFullScreen = !_isFullScreen;
            
            if (_isFullScreen)
            {
                _previousWindowState = this.WindowState;
                
                // CRITICAL FIX: To force WPF to recalculate the bounding box and hide the taskbar,
                // we must briefly drop into Normal state before Maximizing without borders.
                this.WindowState = WindowState.Normal;
                this.WindowStyle = WindowStyle.None;
                this.ResizeMode = ResizeMode.NoResize;
                this.Topmost = true;
                this.WindowState = WindowState.Maximized;
            }
            else
            {
                this.WindowStyle = WindowStyle.SingleBorderWindow;
                this.ResizeMode = ResizeMode.CanResize;
                this.Topmost = false;
                this.WindowState = _previousWindowState;
                ApplyDarkTitleBar();
            }
        }
    }
}