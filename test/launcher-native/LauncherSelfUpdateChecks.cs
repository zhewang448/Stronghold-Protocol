#if SELF_UPDATE
using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;
using NSec.Cryptography;
using StrongholdProtocolLauncher.Services;

static class LauncherSelfUpdateChecks
{
    public static async Task Run()
    {
        var root=Path.Combine(Path.GetTempPath(),"sp-self-update-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
        var checks=0;
        void Check(bool condition,string name){if(!condition)throw new Exception(name);checks++;Console.WriteLine("PASS "+name);}
        async Task Reject(Func<Task> action,string name){try{await action();}catch(Exception e)when(e is IOException or OperationCanceledException){Check(true,name);return;}throw new Exception(name);}
        byte[] Exe(string label){var b=new byte[256];Encoding.ASCII.GetBytes("MZ").CopyTo(b,0);BitConverter.GetBytes(64).CopyTo(b,60);new byte[]{80,69,0,0}.CopyTo(b,64);Encoding.UTF8.GetBytes(label).CopyTo(b,90);return b;}
        byte[] Zip(params (string Path,byte[] Bytes)[] rows){using var bytes=new MemoryStream();using(var archive=new ZipArchive(bytes,ZipArchiveMode.Create,true))foreach(var row in rows){using var output=archive.CreateEntry(row.Path).Open();output.Write(row.Bytes);}return bytes.ToArray();}
        try
        {
            var tag="v0.3.3-extended.999";var asset="StrongholdProtocolLauncher-v9.9.9-win-x64.zip";
            var prefix="https://github.com/"+LauncherSelfUpdate.Repository+"/releases/download/"+tag+"/";
            var old=Exe("old");var next=Exe("new");var zip=Zip((LauncherSelfUpdate.ExecutableName,next),("README.md",Encoding.UTF8.GetBytes("notes")),("THIRD-PARTY-NOTICES.md",Encoding.UTF8.GetBytes("licenses")));
            var sums=Encoding.UTF8.GetBytes(LauncherSelfUpdate.Hash(zip)+"  "+asset+"\n");
            using var key=Key.Create(SignatureAlgorithm.Ed25519);
            var pub=Convert.ToBase64String(Convert.FromHexString("302A300506032B6570032100").Concat(key.PublicKey.Export(KeyBlobFormat.RawPublicKey)).ToArray());
            var signature=Encoding.UTF8.GetBytes(Convert.ToBase64String(SignatureAlgorithm.Ed25519.Sign(key,Encoding.UTF8.GetBytes("stronghold-protocol-release\n"+tag+"\n").Concat(sums).ToArray())));
            LauncherSelfUpdate.VerifyRelease(tag,asset,sums,signature,zip,[pub]);Check(true,"tag-bound Ed25519 signature and ZIP digest verify with native library");
            await Reject(()=>Task.Run(()=>LauncherSelfUpdate.VerifyRelease("v0.3.3-extended.998",asset,sums,signature,zip,[pub])),"foreign release tag cannot reuse a signature");
            await Reject(()=>Task.Run(()=>LauncherSelfUpdate.VerifyRelease(tag,asset,sums,signature,zip.Concat(new byte[]{0}).ToArray(),[pub])),"corrupt ZIP is rejected before replacement");
            await Reject(()=>Task.Run(()=>LauncherSelfUpdate.ExtractExecutable(Zip(("../"+LauncherSelfUpdate.ExecutableName,next)))),"archive traversal rejected");
            await Reject(()=>Task.Run(()=>LauncherSelfUpdate.ExtractExecutable(Zip((LauncherSelfUpdate.ExecutableName,next),("run.cmd",next)))),"unknown archive payload rejected");
            var routes=new Dictionary<string,byte[]>{[prefix+asset]=zip,[prefix+"SHA256SUMS.txt"]=sums,[prefix+"SHA256SUMS.txt.sig"]=signature};
            var assets=new[]{new{name=asset,browser_download_url=prefix+asset},new{name="SHA256SUMS.txt",browser_download_url=prefix+"SHA256SUMS.txt"},new{name="SHA256SUMS.txt.sig",browser_download_url=prefix+"SHA256SUMS.txt.sig"}};
            routes["https://api.github.com/repos/"+LauncherSelfUpdate.Repository+"/releases?per_page=30"]=JsonSerializer.SerializeToUtf8Bytes(new[]{new{tag_name=tag,draft=false,prerelease=false,assets}});
            using var http=new HttpClient(new Handler(routes));var updater=new LauncherSelfUpdate(http);
            var found=await updater.CheckAsync(new Version(1,1,0));Check(found?.Version=="9.9.9","self check compares launcher version without a game directory or Node");
            Check(await updater.CheckAsync(new Version(9,9,9)) is null,"equal launcher version is not repeatedly downloaded");
            var target=Path.Combine(root,LauncherSelfUpdate.ExecutableName);File.WriteAllBytes(target,old);
            using var canceled=new CancellationTokenSource();canceled.Cancel();
            await Reject(async()=>await updater.PrepareAsync(found!,target,token:canceled.Token,parentDirectory:Path.Combine(root,"work"),keys:[pub]),"cancelled download leaves original EXE untouched");
            var plan=await updater.PrepareAsync(found!,target,parentDirectory:Path.Combine(root,"work"),keys:[pub]);
            Check(File.ReadAllBytes(target).SequenceEqual(old),"prepared update does not replace a running launcher early");
            Check(await LauncherSelfUpdate.ApplyAsync(plan,[pub],false,_=>true)==0&&File.ReadAllBytes(target).SequenceEqual(next),"standalone helper replaces target with exact verified EXE bytes");
            using(var receipt=JsonDocument.Parse(File.ReadAllText(target+".release.json")))
                Check(receipt.RootElement.GetProperty("zipHash").GetString()==LauncherSelfUpdate.Hash(zip),"self update records the verified archive hash for the game updater");
            Check(!File.Exists(Path.Combine(Path.GetDirectoryName(plan)!,"release.zip")),"successful self update removes its temporary archive");
            File.WriteAllBytes(target,old);plan=await updater.PrepareAsync(found!,target,parentDirectory:Path.Combine(root,"work"),keys:[pub]);
            Check(await LauncherSelfUpdate.ApplyAsync(plan,[pub],false,_=>false)==1&&File.ReadAllBytes(target).SequenceEqual(old),"restart failure restores pristine original executable");
            plan=await updater.PrepareAsync(found!,target,parentDirectory:Path.Combine(root,"work"),keys:[pub]);File.WriteAllBytes(target,Exe("changed"));
            Check(await LauncherSelfUpdate.ApplyAsync(plan,[pub],false,_=>true)==1&&File.ReadAllBytes(target).SequenceEqual(Exe("changed")),"concurrent target change cannot be overwritten");
            File.WriteAllBytes(target,old);plan=await updater.PrepareAsync(found!,target,parentDirectory:Path.Combine(root,"work"),keys:[pub]);
            using(var sharedLock=new FileStream(target+".update.lock",FileMode.CreateNew,FileAccess.Write,FileShare.None))
                Check(await LauncherSelfUpdate.ApplyAsync(plan,[pub],false,_=>true)==1&&File.ReadAllBytes(target).SequenceEqual(old),"console/self-update shared lock prevents simultaneous replacement");
            File.Delete(target+".update.lock");
            await Reject(()=>Task.Run(()=>LauncherSelfUpdate.AssetUrl(tag,asset,"https://example.com/"+asset)),"foreign download origin is rejected");
            Console.WriteLine("RESULT self_update=true checks="+checks);
        }
        finally{Directory.Delete(root,true);}
    }
    private sealed class Handler(Dictionary<string,byte[]> routes):HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token)
        {token.ThrowIfCancellationRequested();return Task.FromResult(routes.TryGetValue(request.RequestUri!.AbsoluteUri,out var bytes)?new HttpResponseMessage(HttpStatusCode.OK){Content=new ByteArrayContent(bytes)}:new HttpResponseMessage(HttpStatusCode.NotFound));}
    }
}
#endif
