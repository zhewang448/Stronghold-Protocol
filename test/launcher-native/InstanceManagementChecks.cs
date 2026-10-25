#if DISCOVERY
using System.Text.Json;
using StrongholdProtocolLauncher.Services;

static class InstanceManagementChecks
{
    public static async Task Run()
    {
        var work = Path.Combine(Path.GetTempPath(), "sp-instance-check-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        var count = 0;
        void Check(bool ok, string name) { if (!ok) throw new Exception(name); count++; Console.WriteLine("PASS " + name); }
        string Make(string rel, string name = "stronghold-protocol-alliance")
        {
            var root = Path.GetFullPath(Path.Combine(work, rel));
            Directory.CreateDirectory(Path.Combine(root, "server")); Directory.CreateDirectory(Path.Combine(root, "scripts"));
            File.WriteAllText(Path.Combine(root, "package.json"), JsonSerializer.Serialize(new { name }));
            File.WriteAllText(Path.Combine(root, "server/index.js"), "fixture");
            File.WriteAllText(Path.Combine(root, "scripts/launch.mjs"), "fixture");
            File.WriteAllText(Path.Combine(root, "scripts/host-launcher.mjs"), "fixture");
            return root;
        }
        void Reject(Action action, string name) { try { action(); } catch (IOException) { Check(true, name); return; } throw new Exception(name); }
        try
        {
            var one = Make("one"); var two = Make("space directory/two"); var ignored = Make("node_modules/ignored"); Make("foreign", "unrelated");
            Check(InstanceDiscovery.IsInstallation(one) && InstanceDiscovery.IsInstallation(two), "manual import still accepts exact installation roots");
            Check(!InstanceDiscovery.IsInstallation(Path.Combine(work,"foreign")), "manual import rejects unrelated packages");
            Check(typeof(InstanceDiscovery).GetMethod("Scan") is null,"file-scanning discovery implementation is removed");
            var profile = new InstanceProfile("one", "One", one, 3000, "local");
            Check(InstanceDiscovery.ValidateDeletion(profile, [profile], work, _ => false) == one, "stopped isolated installation passes deletion validation");
            Reject(() => InstanceDiscovery.ValidateDeletion(profile, [profile], Path.Combine(one,"launcher")), "running launcher directory is protected");
            Reject(() => InstanceDiscovery.ValidateDeletion(profile, [profile,profile with {Id="nested",Root=Path.Combine(one,"nested")}], work), "parent of another registered instance is protected");
            Directory.CreateDirectory(Path.Combine(one,"logs"));
            var lease = Path.Combine(one,"logs/server-instance-3001.json");
            File.WriteAllText(lease,"{\"pid\":12345}");
            Reject(() => InstanceDiscovery.ValidateDeletion(profile,[profile],work,_ => true), "live service at another recorded port blocks deletion");
            Check(InstanceDiscovery.ValidateDeletion(profile,[profile],work,_ => false)==one, "stale process lease does not block stopped installation");
            File.WriteAllText(lease,"broken");
            try { InstanceDiscovery.ValidateDeletion(profile,[profile],work); throw new Exception("invalid lease"); } catch (JsonException) { Check(true,"unreadable lease cannot authorize deletion"); }
            File.Delete(lease);
            if (OperatingSystem.IsWindows())
            {
                await Task.Run(() => Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(one, Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs,
                    Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin, Microsoft.VisualBasic.FileIO.UICancelOption.ThrowException));
                Check(!Directory.Exists(one) && Directory.Exists(two), "delete recycles only the selected temporary instance");
            }
            Console.WriteLine("RESULT discover=true delete=true checks="+count);
        }
        finally { if (Directory.Exists(work)) Directory.Delete(work,true); }
    }
}
#endif
