#if INSTANCE_NAMING
using System.Text.Json;
using StrongholdProtocolLauncher.Services;

static class InstanceNamingChecks
{
    public static void Run()
    {
        var root=Path.Combine(Path.GetTempPath(),"sp-naming-"+Guid.NewGuid().ToString("N"),"MODIFIED_FILE");
        Directory.CreateDirectory(Path.Combine(root,"server"));
        var count=0;
        void Check(bool condition,string message) { if(!condition)throw new Exception(message);count++;Console.WriteLine("PASS "+message); }
        try
        {
            File.WriteAllText(Path.Combine(root,"package.json"),"{\"version\":\"0.3.3\"}");
            Check(InstanceNaming.DefaultName(root)=="Stronghold Protocol · v0.3.3","upstream version supplies a readable name");
            File.WriteAllText(Path.Combine(root,"server/release-version.js"),"export const RELEASE_TAG = 'v0.3.3-extended.1';\n");
            Check(InstanceNaming.DefaultName(root)=="Stronghold Protocol · v0.3.3-extended.1","extension metadata takes priority without executing code");
            Check(InstanceNaming.DirectoryName(1)=="server-01"&&InstanceNaming.DirectoryName(12)=="server-12"&&InstanceNaming.DirectoryName(100)=="server-100","instance directory sequence has a two-digit minimum");
            Check(InstanceNaming.NormalizeLegacyName("MODIFIED_FILE",root)==InstanceNaming.DefaultName(root),"generic transaction directory name is replaced");
            Check(InstanceNaming.NormalizeLegacyName("朋友联机",root)=="朋友联机","custom instance aliases remain verbatim");
            var profile=new InstanceProfile("stable-id","MODIFIED_FILE",root,3001,"lan");
            var config=Path.Combine(root,"profiles.json");
            File.WriteAllText(config,JsonSerializer.Serialize(new InstanceSettings(profile.Id,[profile])));
            var loaded=InstanceProfiles.Load(config);
            Check(loaded.Instances[0].Name==InstanceNaming.DefaultName(root)&&loaded.Instances[0].Id==profile.Id&&loaded.Instances[0].Root==root&&loaded.Instances[0].Port==3001&&loaded.SelectedId==profile.Id,"legacy name migration preserves instance identity, path and port");
            File.WriteAllText(Path.Combine(root,"server/release-version.js"),"throw new Error('must not execute');");
            Check(InstanceNaming.DefaultName(root)=="Stronghold Protocol · v0.3.3","invalid release text falls back to package version");
            File.WriteAllText(Path.Combine(root,"package.json"),"broken");
            Check(InstanceNaming.DefaultName(root)=="Stronghold Protocol","missing metadata never leaks build directory names");
            Console.WriteLine("RESULT standardized_names=true checks="+count);
        }
        finally { Directory.Delete(Directory.GetParent(root)!.FullName,true); }
    }
}
#endif
