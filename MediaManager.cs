using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using Windows.Media.Control;
using System.Windows.Media.Imaging;

namespace NowPlayingApp
{
    public class MediaPlaybackInfo
    {
        public string Title { get; set; } = string.Empty;
        public string Artist { get; set; } = string.Empty;
        public BitmapImage? Thumbnail { get; set; }
    }

    public class MediaManager
    {
        private GlobalSystemMediaTransportControlsSessionManager? _sessionManager;
        private GlobalSystemMediaTransportControlsSession? _currentSession;
        
        public event EventHandler<MediaPlaybackInfo>? OnMediaChanged;

        public async Task InitializeAsync()
        {
            _sessionManager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            if (_sessionManager != null)
            {
                _sessionManager.CurrentSessionChanged += SessionManager_CurrentSessionChanged;
                await UpdateCurrentSessionAsync();
            }
        }

        private async void SessionManager_CurrentSessionChanged(GlobalSystemMediaTransportControlsSessionManager sender, CurrentSessionChangedEventArgs args)
        {
            await UpdateCurrentSessionAsync();
        }

        private async Task UpdateCurrentSessionAsync()
        {
            if (_sessionManager == null) return;

            var newSession = _sessionManager.GetCurrentSession();
            
            if (_currentSession != null)
            {
                _currentSession.MediaPropertiesChanged -= CurrentSession_MediaPropertiesChanged;
            }

            _currentSession = newSession;

            if (_currentSession != null)
            {
                _currentSession.MediaPropertiesChanged += CurrentSession_MediaPropertiesChanged;
                await UpdateMediaPropertiesAsync(_currentSession);
            }
            else
            {
                OnMediaChanged?.Invoke(this, new MediaPlaybackInfo());
            }
        }

        private async void CurrentSession_MediaPropertiesChanged(GlobalSystemMediaTransportControlsSession sender, MediaPropertiesChangedEventArgs args)
        {
            await UpdateMediaPropertiesAsync(sender);
        }

        private async Task UpdateMediaPropertiesAsync(GlobalSystemMediaTransportControlsSession session)
        {
            try
            {
                var properties = await session.TryGetMediaPropertiesAsync();
                if (properties == null) return;

                var info = new MediaPlaybackInfo
                {
                    Title = string.IsNullOrEmpty(properties.Title) ? "No Media Playing" : properties.Title,
                    Artist = properties.Artist ?? ""
                };

                if (properties.Thumbnail != null)
                {
                    using var stream = await properties.Thumbnail.OpenReadAsync();
                    var dotNetStream = stream.AsStreamForRead();
                    
                    var bitmap = new BitmapImage();
                    bitmap.BeginInit();
                    bitmap.CacheOption = BitmapCacheOption.OnLoad;
                    bitmap.StreamSource = dotNetStream;
                    bitmap.EndInit();
                    bitmap.Freeze(); // Freeze required to pass from background thread to UI thread
                    
                    info.Thumbnail = bitmap;
                }

                OnMediaChanged?.Invoke(this, info);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Error retrieving media properties: {ex.Message}");
            }
        }
    }
}
