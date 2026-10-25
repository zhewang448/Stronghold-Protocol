#if INSTANCE_INDEX
using System.Text.Json;
using StrongholdProtocolLauncher.Services;

static class InstanceIndexChecks
{
    public static async Task Run()
    {
        var work = Path.Combine(Path.GetTempPath(), "sp-index-check-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        var count = 0;
        void Check(bool condition, string label) { if (!condition) throw new Exception(label); count++; Console.WriteLine("PASS " + label); }
        string Make(string rel)
        {
            var root = Path.GetFullPath(Path.Combine(work, rel));
            Directory.CreateDirectory(Path.Combine(root,"server"));Directory.CreateDirectory(Path.Combine(root,"scripts"));
            File.WriteAllText(Path.Combine(root,"package.json"),"{\"name\":\"stronghold-protocol-alliance\"}");
            foreach (var file in new[]{"server/index.js","scripts/launch.mjs","scripts/host-launcher.mjs"}) File.WriteAllText(Path.Combine(root,file),"fixture");
            return root;
        }
        try
        {
            var index=Path.Combine(work,"index");var managed=Path.Combine(work,"managed");
            var one=Make("one");var two=Make("two");var direct=Make("managed/direct");var deep=Make("managed/container/deep");
            InstanceIndex.Register(one,3000,index);InstanceIndex.Register(one,3001,index);
            Check(Directory.GetFiles(index,"*.json").Length==1,"register same root atomically without duplicate entries");
            var json=File.ReadAllText(Directory.GetFiles(index,"*.json")[0]);
            Check(!json.Contains("token") && !json.Contains("admin") && json.Contains("3001"),"discovery metadata excludes credentials and updates port");
            await Task.WhenAll(Task.Run(()=>InstanceIndex.Register(one,3000,index)),Task.Run(()=>InstanceIndex.Register(two,3002,index)));
            Check(InstanceIndex.Read(index).Length==2,"independent instance writers retain both index records");
            File.WriteAllText(Path.Combine(index,"broken.json"),"broken");
            File.WriteAllText(Path.Combine(index,"missing.json"),JsonSerializer.Serialize(new{format=1,root=Path.Combine(work,"missing")}));
            Check(InstanceIndex.Read(index).Length==2,"invalid and stale index records are filtered without deleting source data");
            var discovered=InstanceIndex.Discover([one],index);
            Check(discovered.Length==2 && !discovered.Contains(direct) && !discovered.Contains(deep),"discovery reads only indexed or explicitly known roots, never inspects installation folders");
            InstanceIndex.Forget(one,index);
            Check(InstanceIndex.Read(index).SequenceEqual(new[]{two}) && Directory.Exists(one),"forget removes discovery record and preserves installation bytes");
            InstanceIndex.Register(deep,0,index);
            Check(InstanceIndex.Read(index).Length==1,"invalid registration port is rejected");
            Directory.Delete(two,true);
            Check(InstanceIndex.Read(index).Length==0,"deleted installations disappear from discovery");
            Console.WriteLine("RESULT indexed=true automatic_registration=true checks="+count);
        }
        finally { Directory.Delete(work,true); }
    }
}
#endif
