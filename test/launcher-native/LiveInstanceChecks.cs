#if LIVE_DISCOVERY
using System.Text.Json;
using StrongholdProtocolLauncher.Services;

static class LiveInstanceChecks
{
    public static async Task Run()
    {
        var work = Path.Combine(Path.GetTempPath(), "sp-live-check-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        var checks=0;
        void Check(bool condition,string message) { if (!condition) throw new Exception(message); checks++; Console.WriteLine("PASS "+message); }
        try
        {
            var root=Path.Combine(work,"space install");Directory.CreateDirectory(Path.Combine(root,"server"));Directory.CreateDirectory(Path.Combine(root,"scripts"));
            File.WriteAllText(Path.Combine(root,"package.json"),"{\"name\":\"stronghold-protocol-alliance\"}");
            foreach(var file in new[]{"server/index.js","scripts/launch.mjs","scripts/host-launcher.mjs"})File.WriteAllText(Path.Combine(root,file),"fixture");
            var command="\"C:\\node folder\\node.exe\" \""+Path.Combine(root,"server/index.js")+"\"";
            Check(LiveInstanceDiscovery.RootFromCommand(command)==root,"absolute quoted Node entry resolves installation with spaces");
            Check(LiveInstanceDiscovery.RootFromCommand("node server/index.js")==null,"relative entry cannot falsely claim an installation root");
            Check(LiveInstanceDiscovery.RootFromCommand("node -e \"console.log('server/index.js')\"")==null,"inline JavaScript is never executed or treated as a root");
            var health=JsonSerializer.Serialize(new{ok=true,version=1,app="0.3.3",content=new{vanilla=new string('a',64)}});
            Check(LiveInstanceDiscovery.IsGameHealth(health,out var version)&&version=="0.3.3","game health requires protocol version and content identity");
            Check(!LiveInstanceDiscovery.IsGameHealth("{\"ok\":true,\"app\":\"0.3.3\"}",out _),"unrelated HTTP health endpoint is rejected");
            var calls=new List<string>();
            Task<string?> Probe(Uri uri,CancellationToken token) { calls.Add(uri.ToString());return Task.FromResult<string?>(uri.Port==3001?health:null); }
            var rows=new[]{new ListeningProcess(123,3001,command,"127.0.0.1"),new ListeningProcess(123,3001,command,"0.0.0.0"),new ListeningProcess(123,3101,command,"127.0.0.1"),new ListeningProcess(99,5555,"node foreign.js","127.0.0.1")};
            var found=await LiveInstanceDiscovery.DiscoverAsync(rows,Probe);
            Check(found.Length==1&&found[0].Root==root&&found[0].Port==3001,"listener and valid health discover old unindexed installation");
            Check(calls.Count==2&&calls.All(uri=>uri.StartsWith("http://127.0.0.1:")),"only actual matching Node listeners receive loopback GET requests");
            Directory.CreateDirectory(Path.Combine(root,"logs"));File.WriteAllText(Path.Combine(root,"logs/server-instance-3001.json"),"{\"pid\":999,\"port\":3001}");
            Check((await LiveInstanceDiscovery.DiscoverAsync(rows,Probe)).Length==0,"stale PID lease cannot bind the wrong listener");
            using var canceled=new CancellationTokenSource();canceled.Cancel();
            try { await LiveInstanceDiscovery.DiscoverAsync(rows,Probe,canceled.Token);throw new Exception("cancellation"); } catch(OperationCanceledException) { Check(true,"discovery cancellation stops immediately"); }
            Console.WriteLine("RESULT live_ports=true checks="+checks);
        }
        finally { Directory.Delete(work,true); }
    }
}
#endif
