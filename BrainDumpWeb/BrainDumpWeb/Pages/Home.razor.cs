using BrainDumpWeb.Enums;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;

namespace BrainDumpWeb.Pages
{
    public partial class Home
    {
        private readonly string _jsVersion = "1";

        private IJSObjectReference? _module;

        private DumpState State = DumpState.PromptingText;

        private string _dumpText = string.Empty;

        private DotNetObjectReference<Home>? dotNetRef;

        [Inject]
        public required IJSRuntime JS { get; set; }

        public async ValueTask DisposeAsync()
        {
            if (_module != null)
            {
                await _module.DisposeAsync().ConfigureAwait(false);
            }

            dotNetRef?.Dispose();
        }

        [JSInvokable]
        public async Task NotifyTearingComplete()
        {
            State = DumpState.TearedDown;

            await InvokeAsync(StateHasChanged);
        }

        protected override async Task OnAfterRenderAsync(bool firstRender)
        {
            if (firstRender)
            {
                _module = await JS
                    .InvokeAsync<IJSObjectReference>("import", $"./Pages/Home.razor.js?v={_jsVersion}")
                    .ConfigureAwait(false);

                dotNetRef = DotNetObjectReference.Create(this);
                await JS.InvokeVoidAsync("updateDotnetRef", dotNetRef);
            }
        }

        private Task Restart()
        {
            _dumpText = string.Empty;
            State = DumpState.PromptingText;

            return Task.CompletedTask;
        }

        private async Task Dump()
        {
            State = DumpState.ConvertingToCanvas;

            await InvokeAsync(StateHasChanged);

            await Task.Delay(100);

            var imageDataUrl = await JS.InvokeAsync<string>("window.convertRichTextToImage");

            await JS.InvokeVoidAsync("window.initTearableCanvas", imageDataUrl);

            State = DumpState.ShowingCanvas;

            await InvokeAsync(StateHasChanged);
        }
    }
}
