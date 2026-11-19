# 骷髅手指光标

在「设置 → 界面与操作 → 骷髅手指光标」开启。新用户默认使用系统指针。已有「系统鼠标／方舟鼠标」设置分别对应关闭／开启，服主可设置默认值或锁定选项。比例随视口宽度调整。

光标采用上游 #948 的 Canvas 动画与原版 Windows 客户端图集。普通指向和按钮点击显示鼠标手。文字、拖拽、缩放和强制高对比度使用系统指针。触摸和笔输入隐藏手形，系统减少动态效果时按压动作直接切换姿态。缺少素材或绘制失败时使用系统指针。

## 素材

安装 UnityPy 和 Pillow 后，可从本机 Windows 客户端定向提取。

```bash
python tools/local-extract/extract.py --game <客户端目录> --only ui/cursor
```

提取器在 `public/assets/local/ui/cursor/` 生成图集，将帧布局、缩放和热点登记到 `data/local-assets.json`。完整安装或本机素材分包可随该清单提供图集。 [上游 PR #948](https://github.com/sganggs/Stronghold-Protocol/pull/948) · [素材说明](ASSETS.md#prts-骷髅手指光标)
