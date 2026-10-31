# 决战中途岛 · MIDWAY 1942

原生 JavaScript + Three.js 的浏览器街机空战游戏。驾驶战机迎击拦截机、躲避舰炮、俯冲投弹，击沉敌方航母并返回友舰补给。

**[在线游玩](https://ihca.cn/midway/)** · [素材署名与许可](assets/licenses/IMPORTED-MODELS.md) · [飞行玩法设计](docs/flight-combat.md)

![决战中途岛封面](assets/ui/midway-cover.webp)

本仓库包含截至 **2026-10-31** 的游戏源码、本地 Three.js 库、飞机与舰船模型、音效、界面资源和测试脚本。无需 npm 安装、CDN 或游戏服务器即可在本地运行。

## 本地运行

需要 Python 3：

```sh
git clone https://github.com/xilinnihao-afk/midway-1942.git
cd midway-1942
python3 -m http.server 8080
```

打开 **http://localhost:8080/**。手机访问同一局域网地址即可体验；陀螺仪权限需要 HTTPS 或浏览器认可的安全环境。

如需双击 `index.html` 离线运行，先生成离线模块与资源镜像：

```sh
python3 scripts/pack.py
```

生成的 `standalone.js` 和两份 `embedded.js` 不提交到 Git，避免重复存储模型和音频。HTTP 模式直接加载独立源码和资源，不需要这一步。

## 游戏内容

- 多机型选择、友方僚机、敌机编队与持续增援。
- 持续机炮、可选自动辅助瞄准、提前量指示、真实弹道及空间音效。
- 俯冲投弹、重力炸弹、落点提示、拉起警报和返航补给。
- 舰船巡航、舰炮、防空、受损与沉没表现。
- Tidewater 海面：多层海浪频谱、GPU FFT、泡沫、天空反射与舰船浮力。
- 手机摇杆、触屏瞄准、持续开火、可选陀螺仪，以及长按和音频恢复兼容处理。

本作是单关单机街机游戏。机型与舰船外观为玩法服务，不是严格史实复原或完整气动飞行模拟。

## 操作

电脑使用鼠标和键盘控制航向与俯仰，按住鼠标左键或 **F** 开火，**Space / B** 投弹，**W / S** 调整油门。完整按键以游戏内操作提示为准。

手机使用摇杆、滑动瞄准和开火 / 投弹按钮。设置中可调整灵敏度、辅助瞄准、声音和陀螺仪。首次出击或点击声音检测会解锁浏览器音频。

## 检查与离线打包

开发检查需要 **Node.js 22.15+**；不依赖 npm 包：

```sh
node scripts/test-all.mjs
python3 scripts/pack.py
node --experimental-vm-modules scripts/check-offline.mjs
```

也可使用 `npm test` 和 `npm run build`。测试涵盖瞄准、俯冲安全、移动端输入、陀螺仪、声音恢复、加载、模型量化和海面频谱。浏览器调试入口 `?debug&qa` 提供飞行与战斗检查。

## 目录

| 目录 / 文件 | 内容 |
| --- | --- |
| `index.html`、`boot.js`、`styles.css` | 页面、加载进度、响应式界面 |
| `js/FlightManager.js` | 飞行、敌机、射击、炸弹与补给 |
| `js/ShipManager.js` | 舰船、碰撞、浮力和沉没 |
| `js/Tidewater*.js` | 海浪频谱、FFT、海面与天空 |
| `js/UIManager.js`、`js/FlightControls.js` | HUD、键鼠与触屏输入 |
| `js/AudioManager.js`、`js/CombatEffects.js` | 声音、枪口、曳光、爆炸 |
| `assets/` | 模型、音效、封面、纹理和许可 |
| `vendor/` | 本地 Three.js、GLTFLoader 及其许可 |
| `scripts/` | 检查、资源处理与离线打包 |

模型参数位于 `js/config.js`。统计和反馈入口仅在原在线游戏域名启用，普通本地或 GitHub 克隆运行不会向该服务发送数据。

## 许可

原创代码采用 [MIT License](LICENSE)。海面移植保留 [Tidewater MIT 许可](assets/licenses/TIDEWATER-LICENSE.txt)，Three.js 许可见 [vendor/THREE-LICENSE.txt](vendor/THREE-LICENSE.txt)。

第三方模型使用各自许可证：**F4F、F4U-4 和 Spitfire 为 CC BY-NC 4.0，限定非商业使用**；其他导入模型的 CC BY 署名、来源及修改记录见 [IMPORTED-MODELS.md](assets/licenses/IMPORTED-MODELS.md)。源码 MIT 许可不覆盖第三方模型或解除其使用限制。详细范围见 [NOTICE.md](NOTICE.md)。

欢迎通过 GitHub Issues 反馈设备、浏览器、复现步骤和预期行为。
