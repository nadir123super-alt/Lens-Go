# OTA 热更新使用指南 —— 改代码不用重新打包 APK

## 一、核心概念

**OTA（Over-The-Air）热更新**：把 JS/TS 代码改动推送到云端，App 启动时自动下载并应用新代码，**无需重新打包 APK、无需重新安装**。

| 改动类型 | 是否需要重新打包 APK | 说明 |
|----------|---------------------|------|
| **JS/TS 代码**（逻辑、UI、样式） | ❌ **不需要** | 用 `eas update` 推送，秒级生效 |
| **图片/字体等资源** | ❌ **不需要** | 同上 |
| **环境变量**（`EXPO_PUBLIC_*`） | ❌ **不需要** | 同上（需重新 update） |
| **原生代码/依赖** | ✅ 需要 | 如新增 `expo-camera` 等原生模块 |
| **权限变更**（app.json permissions） | ✅ 需要 | 权限写在 AndroidManifest |
| **应用图标/名称/包名** | ✅ 需要 | 原生资源 |
| **SDK 版本升级** | ✅ 需要 | 原生层变化 |

> **结论**：90% 的日常开发（改逻辑、修 bug、调 UI）都只需 `eas update`，不用重新打包。

---

## 二、首次准备（只需做一次）

### 步骤 1：构建带 OTA 能力的 APK

OTA 功能需要**首次构建时**就集成到 APK 里。执行：

```cmd
npx eas build --platform android --profile preview
```

首次构建时 EAS 会提示生成 keystore，输入 `Y` 回车。

> ⚠️ **这是最后一次需要手动安装 APK**。之后所有 JS 改动都用 `eas update` 推送。

### 步骤 2：安装这个 APK

构建完成后下载安装。这个版本已经内置了 OTA 更新能力。

---

## 三、日常使用（改代码后）

### 场景：你修改了某个页面的代码

```cmd
npx eas update --branch preview --message "修复登录页样式"
```

- `--branch preview`：推送到 preview 渠道（对应 `eas.json` 里 preview profile 的 `channel: "preview"`）
- `--message`：更新说明（方便回溯）

**执行后**：
1. 终端会输出更新 ID 和链接
2. 用户**下次打开 App 时**自动下载并应用新代码
3. 无需任何手动操作

### 场景：想立即看到效果（开发时）

在 App 内下拉刷新，或完全关闭 App 再打开，即可触发更新检查。

---

## 四、完整工作流示例

假设你修复了一个 bug：

```cmd
# 1. 修改代码（如 services/AuthContext.tsx）

# 2. 提交到 Git（可选，但推荐）
git add .
git commit -m "fix: 修复 xxx"
git push

# 3. 推送 OTA 更新
npx eas update --branch preview --message "fix: 修复 xxx"

# 完成！用户下次打开 App 自动更新
```

**对比之前**：以前要 `eas build`（等 10-20 分钟）+ 下载 + 安装。现在 `eas update` 只需 **10-30 秒**。

---

## 五、渠道（Channel）说明

[`eas.json`](../eas.json) 中配置了三个渠道：

| Profile | Channel | 用途 |
|---------|---------|------|
| `development` | `development` | 开发调试（带 dev client） |
| `preview` | `preview` | 内测分发（你现在用的） |
| `production` | `production` | 正式发布（上架商店） |

**推送更新时，branch 名要和 channel 对应**：

```cmd
# 推送到 preview 渠道
npx eas update --branch preview --message "..."

# 推送到 production 渠道（正式用户）
npx eas update --branch production --message "..."
```

---

## 六、回滚更新

如果推送的更新有问题，可以回滚：

```cmd
# 查看更新历史
npx eas update:list --branch preview

# 回滚到某个版本（用 update ID）
npx eas update:republish --branch preview --group <update-group-id>
```

或在 [Expo 控制台](https://expo.dev/accounts/dirna/projects/lensgo/updates) 图形化操作。

---

## 七、runtimeVersion 说明

[`app.json`](../app.json) 配置了：

```json
"runtimeVersion": "1.0.0"
```

**作用**：OTA 更新只推送给**兼容的 App 版本**。

- 当前 runtimeVersion 是 `1.0.0`
- 只有 runtimeVersion 为 `1.0.0` 的 App 会收到这些 OTA 更新
- 如果你改了 runtimeVersion（如 `1.1.0`），需要重新构建 APK

> ⚠️ **为什么用固定版本号而不是 `{"policy": "appVersion"}`？**
>
> 因为项目曾存在 `android/` 目录（bare workflow），EAS 不支持动态策略，会报错：
> `You're currently using the bare workflow, where runtime version policies are not supported`
>
> 现已删除 `android/` 目录回归 CNG 模式，但固定版本号更简单可控，故保留。

**重要**：只要不改 runtimeVersion，OTA 更新就能一直推送给已安装的用户。

---

## 八、什么时候必须重新打包 APK

以下情况 OTA 无法解决，必须 `eas build`：

1. **新增/删除原生依赖**（如 `expo-camera`、`react-native-xxx`）
2. **修改 `app.json` 的 permissions**
3. **修改应用图标、名称、包名、启动屏**
4. **升级 Expo SDK 版本**
5. **修改 `version` 字段**
6. **新增原生插件（plugins）**

> 简单判断：**只要动了 `package.json` 的 dependencies 或 `app.json` 的原生配置，就要重新打包**。

---

## 九、常见问题

**Q：OTA 更新对用户是透明的吗？**
A：是的。用户打开 App 时后台下载，下次启动生效。不会弹窗打扰。

**Q：更新下载失败怎么办？**
A：App 会继续用旧版本，下次启动重试。不会崩溃。

**Q：能强制用户立即更新吗？**
A：可以，用 `expo-updates` 的 `reloadAsync()` API 主动触发。但一般不需要。

**Q：OTA 更新有大小限制吗？**
A：单次更新建议 < 50MB。你的项目 JS 代码很小，没问题。

**Q：用户断网时能更新吗？**
A：不能，但会用缓存的旧版本正常运行。

**Q：怎么知道用户是否更新了？**
A：在 [Expo 控制台](https://expo.dev/accounts/dirna/projects/lensgo/updates) 查看每个更新的下载量。

**Q：preview 和 production 的更新会混吗？**
A：不会。它们用不同的 channel，互相隔离。

---

## 十、快速参考

```cmd
# 首次：构建带 OTA 的 APK（只需一次）
npx eas build --platform android --profile preview

# 日常：推送 JS 代码更新（秒级）
npx eas update --branch preview --message "更新说明"

# 查看更新历史
npx eas update:list --branch preview

# 回滚
npx eas update:republish --branch preview --group <id>

# 必须重新打包的情况
npx eas build --platform android --profile preview
```

---

## 十一、注意事项

1. **首次必须重新构建 APK**：OTA 能力需要内置到 APK 中，当前已安装的旧 APK 不支持 OTA。
2. **不要随意改 `version`**：改了会导致 OTA 更新无法推送给旧版本用户。
3. **原生改动必须重新打包**：见第八节。
4. **测试渠道隔离**：preview 的更新不会影响 production 用户。
