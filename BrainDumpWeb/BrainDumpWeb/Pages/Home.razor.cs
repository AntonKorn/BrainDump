using System.Globalization;

namespace BrainDumpWeb.Pages
{
    public partial class Home
    {
        private string _dumpText = string.Empty;
        private int? _dumpingProgress;
        private readonly int _dumpingProgressIncrement = 5;
        private string _damageBackgroundOpacity = "0";
        private bool _dumpingSucceeded = false;

        private bool _showHypingWords = false;
        private bool _canRestart = false;
        private int _restartDelayMilliseconds = 1000;

        private Task Restart()
        {
            _dumpText = string.Empty;
            _dumpingProgress = null;
            _damageBackgroundOpacity = "0";
            _dumpingSucceeded = false;
            _canRestart = false;
            _showHypingWords = false;

            return Task.CompletedTask;
        }

        private async Task Dump()
        {
            if (!_dumpingProgress.HasValue)
            {
                _dumpingProgress = 0;
            }

            _dumpingProgress += _dumpingProgressIncrement;

            _damageBackgroundOpacity = (_dumpingProgress.Value / 100f).ToString(CultureInfo.InvariantCulture);

            if (_dumpingProgress.Value == 100)
            {
                _dumpingSucceeded = true;

                StateHasChanged();

                await Task.Delay(_restartDelayMilliseconds).ConfigureAwait(true);

                _canRestart = true;
                _showHypingWords = true;

                StateHasChanged();
            }
        }
    }
}
