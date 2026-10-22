using System.Windows;

namespace StrongholdProtocolLauncher;

public partial class App : Application
{
    internal static string? PreviewDirectory { get; private set; }
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        if (e.Args.Length == 2 && e.Args[0] == "--render-preview") PreviewDirectory = Path.GetFullPath(e.Args[1]);
        MainWindow = new MainWindow();
        MainWindow.Show();
    }
}
