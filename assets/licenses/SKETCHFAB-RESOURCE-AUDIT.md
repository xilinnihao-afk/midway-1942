# Sketchfab 模型体积与下载审计（2026-10-15）

## 已有本地模型已轻量化

项目已有的 6 个 Sketchfab 模型均保留原作者、许可和来源元数据。原始项目模型备份在 `artifacts/model-menu-20261015/original-models/`，本机 Downloads 原文件未修改。下表单位为 MB（1,000,000 字节）。

| 文件 | 优化前 | 优化后 | 三角面（文件内） |
|---|---:|---:|---:|
| `a6m_zero_low_poly.glb` | 1.13 | 0.36 | 821 |
| `imported_f4f.glb` | 1.86 | 0.68 | 3,140 |
| `f4u-4.glb` | 2.45 | 0.89 | 3,135 |
| `essex_aircraft_carrier.glb` | 9.33 | 4.48 | 97,420 |
| `british_v-class_destroyer_ww1.glb` | 11.96 | 5.19 | 114,807 |
| `supermarine_spitfire.glb` | 5.74 | 2.65 | 6,298 |

合计 32.47 MB → 14.24 MB，减少 56.2%。最大驱逐舰 5.19 MB（4.95 MiB）。

处理方法：重复资源去重、逐位相同顶点焊接、贴图最大边 1024、保持原 PNG/JPEG 格式与透明通道；两艘舰船使用标准 `KHR_mesh_quantization`（位置 16 位、法线 8 位、UV 14 位；跨格重复 UV 保留原浮点）。Three.js GLTFLoader 原生支持该扩展，无需 Draco、Meshopt 或纹理解码器。加载器在烘焙世界矩阵前必须将量化属性展开为浮点，否则会因写回整数属性产生溢出。

几何核验逐个场景节点、逐个三角面顶点比较世界坐标，所有模型三角面与实例数保持一致，最大相对坐标误差 < 0.002%；四架飞机最大坐标误差为 0.000014 原模型单位。模型方向、场景变换、材质和许可证均保留。核验记录为 `artifacts/model-menu-20261015/geometry-verification.json`。

可复现脚本：`scripts/optimize-imported-models.mjs`。依赖只用于制作，不进入运行时。

## 新巡洋舰（2026-10-16 已由用户下载并接入）

- 模型：[Graf Spee (low poly)](https://sketchfab.com/3d-models/graf-spee-low-poly-0e4575cd053c490491e8eda7ced005e5)
- 作者：[Götz von Berlichingen](https://sketchfab.com/vonBerlichingen)
- 许可：[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 页面三角面约 5,200，顶点约 3,700；作者说明为其自行制作的 HUMANKIND 模组模型。
- 官方下载弹窗：GLB 996 kB / 1k 贴图；glTF 849 kB；原 DAE 2 MB。
- 已通过现有 Chrome 登录态进入官方下载弹窗并点击 GLB 下载，但实际跳转被 Chrome 阻止：`sketchfab-prod-media.s3.amazonaws.com 已被屏蔽 / ERR_BLOCKED_BY_CLIENT`。本次没有获得该文件，也未绕过此拦截。
- 公开 `api.sketchfab.com/v3/search` 另实测为 HTTP 401，但网页登录态可搜索并显示下载选项。
- 文件未落地，故不能确认朝向、水线或接入运行时；建议获取文件后替换 `cruiser` 的程序模型，按巡洋舰战斗角色使用并注明其外形并非中途岛参战舰。

2026-10-16 更新：用户已下载 Graf Spee GLB，已适配接入两个巡洋舰的近景外观；远景保留项目低模。源文件1,019,980字节，适配后1,020,100字节，5,168三角面，1张1024贴图、1个材质。四艘航母仍使用已有 Essex 外形。下述阻塞为此前历史记录，现已解除。HMS London、IJN Mogami 与 HMS Aurora 候选均有 19–30 万三角面，不符合本次轻量目标，因此未下载。
