# 用户提供模型的来源与署名

这些模型由用户从本机 Downloads 提供。原始 GLB 的 `asset.extras` 含以下来源与许可证；项目保留了元数据。

| 模型 | 作者 | 许可 | 原始来源 |
|---|---|---|---|
| A6M Zero Low Poly | Waroxed | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | https://sketchfab.com/3d-models/a6m-zero-low-poly-38311e82157449448f703b53648614a5 |
| F4F | ThomasBeerens | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) | https://sketchfab.com/3d-models/f4f-735d468db7664fa486e43f7b30cdfea1 |
| F4U-4 | ThomasBeerens | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) | https://sketchfab.com/3d-models/f4u-4-7e4d8e48849f46b98f212017a40d0761 |
| Essex Aircraft carrier | philano | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | https://sketchfab.com/3d-models/essex-aircraft-carrier-4a60a989106c40d0bfb70f8504c6de67 |
| British V-class Destroyer WW1 | fabirbige | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | https://sketchfab.com/3d-models/british-v-class-destroyer-ww1-31c8572cc5e64244b15b0963edbe99cb |
| Graf Spee (low poly) | Götz von Berlichingen | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | https://sketchfab.com/3d-models/graf-spee-low-poly-0e4575cd053c490491e8eda7ced005e5 |
| Supermarine Spitfire | Renafox | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) | https://sketchfab.com/3d-models/supermarine-spitfire-8349f26e1e88455da75dd7352b02b794 |

适配修改：移除展示地面与灯光引用；常量颜色纹理转换为线性材质因子；运行时合并同材质网格；修正朝向、缩放与水线；为螺旋桨添加运行时旋转；远距离使用原项目简化模型。

F4F、F4U-4 和 Spitfire 的 BY-NC 授权限定非商业使用。游戏代码的 MIT 许可不覆盖这些第三方模型。发布时应随包保留本署名文件和相应许可链接。

海水实现参考并移植 tidewater（Copyright © 2026 DRG Software Solutions LLC），MIT 授权原文见 `TIDEWATER-LICENSE.txt`。

空战版适配：Spitfire 删除原场景中的展示侧倾/俯仰姿态，规范为机头 +Z、机背 +Y；驱逐舰 47 个子网格贴图合入 2048² 图集，其余跨格重复 UV 保留，最终 4 个材质；索引按可用范围压为 16 位；保留全部原始三角面。制作脚本为 `scripts/prepare-flight-assets.py`。英国 V 级驱逐舰、Spitfire 外观按用户要求用于街机玩法，不表示中途岛历史参战型号。

2026-10-15 轻量化：6 个第三方模型合计从 32.47 MB 降为 14.24 MB，保留作者与许可元数据。舰船使用原生 `KHR_mesh_quantization`，运行时先展开浮点属性再烘焙矩阵。选机图为本项目对应模型的实际渲染。完整大小、处理方式与尚未下载的巡洋舰候选见 `SKETCHFAB-RESOURCE-AUDIT.md`。

2026-10-16 巡洋舰接入：用户下载 Graf Spee GLB（约1.02MB / 5,168三角面）用于双方巡洋舰外观。保留原几何、1024贴图和署名，适配漫反射涂装的金属度0.08/粗糙度0.62，校正舰艏方向和水线。战斗角色仍为原舰队配置，不表示历史参战型号复原。制作脚本 `scripts/prepare-cruiser.py`。
