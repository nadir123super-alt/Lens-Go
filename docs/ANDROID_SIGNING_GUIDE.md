# Android APK 签名配置指南 —— 解决"风险应用"安装提醒

## 一、问题现象

安装 APK 时，系统（尤其是小米 / 华为 / OPPO / vivo / 荣耀等国产 ROM）弹出：

> ⚠️ 检测到风险，此应用可能危害您的设备安全
> 该应用未经过安全检测 / 来源未知 / 使用调试签名

## 二、根本原因

这个提醒**不是病毒或代码问题**，而是以下因素叠加触发系统安全策略：

| 因素 | 说明 | 影响程度 |
|------|------|----------|
| **调试签名（debug keystore）** | EAS `preview` profile 默认用调试密钥签名，系统识别为"开发中应用" | ★★★★★ 主因 |
| **侧载分发（sideload）** | 未通过应用商店，无信任背书 | ★★★★ |
| **敏感权限** | 录音、日历等敏感权限触发安全扫描 | ★★★ |
| **未上架商店** | 无 Google Play / 应用宝等商店的签名校验 | ★★★ |

## 三、解决方案

### 方案 A：使用正式发布签名（推荐，根治）

#### 步骤 1：生成正式 keystore

在项目根目录执行（Windows CMD）：

```cmd
keytool -genkeypair -v ^
  -storetype JKS ^
  -keystore release.keystore ^
  -alias lensgo ^
  -keyalg RSA ^
  -keysize 2048 ^
  -validity 10000 ^
  -storepass 你的密钥库密码 ^
  -keypass 你的密钥密码 ^
  -dname "CN=Lens Go, OU=Dev, O=LensGo, L=Beijing, ST=Beijing, C=CN"
```

> ⚠️ **务必备份 `release.keystore` 和密码！** 丢失后无法更新已发布的应用。

#### 步骤 2：配置 credentials.json

在项目根目录创建 `credentials.json`：

```json
{
  "android": {
    "keystore": {
      "keystorePath": "release.keystore",
      "keystorePassword": "你的密钥库密码",
      "keyAlias": "lensgo",
      "keyPassword": "你的密钥密码"
    }
  }
}
```

> ⚠️ **将 `credentials.json` 和 `release.keystore` 加入 `.gitignore`，绝对不要提交到 Git！**

#### 步骤 3：确认 eas.json 配置

[`eas.json`](../eas.json) 的 `preview` profile 已配置为使用本地签名：

```json
"preview": {
  "distribution": "internal",
  "android": {
    "buildType": "apk",
    "gradleCommand": ":app:assembleRelease",
    "credentialsSource": "local"
  }
}
```

#### 步骤 4：重新构建

```cmd
npx eas build --platform android --profile preview --local
```

或云端构建（需先 `npx eas credentials` 上传 keystore）：

```cmd
npx eas build --platform android --profile preview
```

---

### 方案 B：上传 keystore 到 EAS（云端构建推荐）

如果使用 EAS 云端构建，把 keystore 交给 EAS 管理：

```cmd
npx eas credentials
```

交互式选择：
1. `Android` → 选择项目
2. `Keystore: Manage everything needed to build your project`
3. `Set up a new keystore`（或 `Upload an existing keystore`）
4. 按提示输入 keystore 路径和密码

配置完成后，EAS 云端构建会自动使用正式签名。

---

### 方案 C：临时绕过（仅用于自测，不推荐分发）

如果只是自己测试，可在手机上手动放行：

1. **小米**：设置 → 应用设置 → 应用管理 → 找到应用 → 权限管理 → 信任此应用
2. **华为**：设置 → 安全 → 更多安全设置 → 安装外部来源应用 → 允许
3. **OPPO/vivo**：设置 → 安全 → 安装未知应用 → 允许
4. **通用**：安装时点击"仍然安装" / "继续安装"

> ⚠️ 这只是绕过提醒，**不能根治**。分发给他人时仍会提示。

---

## 四、已完成的代码优化

本次已修改以下配置，减少安全告警：

### 1. [`app.json`](../app.json) —— 移除不必要的敏感权限

**移除前**：
```json
"permissions": [
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.READ_CALENDAR",      // ← 移除
  "android.permission.WRITE_CALENDAR"      // ← 移除
]
```

**移除后**：
```json
"permissions": [
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS"
]
```

> 日历权限（READ/WRITE_CALENDAR）是敏感权限，会显著提高安全告警等级。经检查代码中**完全未使用**日历功能，故移除。

### 2. [`app.json`](../app.json) —— 移除 `expo-calendar` 插件

`expo-calendar` 插件会在 AndroidManifest.xml 中自动注入日历权限。已从 plugins 数组移除。

### 3. [`eas.json`](../eas.json) —— preview 使用本地正式签名

添加 `"credentialsSource": "local"`，让 preview 构建使用正式 keystore 而非调试签名。

---

## 五、验证签名是否生效

构建完成后，验证 APK 签名：

```cmd
keytool -printcert -jarfile app-release.apk
```

**调试签名**会显示：
```
Owner: CN=Android Debug, O=Android, C=US
```

**正式签名**会显示你配置的信息：
```
Owner: CN=Lens Go, OU=Dev, O=LensGo, L=Beijing, ST=Beijing, C=CN
```

看到自己的信息即表示签名成功。

---

## 六、彻底消除提醒的终极方案

如果希望**完全消除**风险提醒，唯一可靠的方式是：

1. **上架应用商店**（Google Play / 华为应用市场 / 小米应用商店 / 应用宝等）
   - 商店会对应用做安全检测并背书
   - 用户从商店安装不会有任何提醒

2. **申请 Google Play App Signing**
   - 由 Google 托管签名密钥，系统完全信任

3. **国内分发**：上架华为/小米/OPPO/vivo 应用市场，各厂商会做安全认证

> 对于个人学习项目，**方案 A（正式签名）+ 方案 C（手动放行）** 已足够。

---

## 七、常见问题

**Q：为什么昨天能用，今天提示风险？**
A：可能是系统安全策略更新，或之前安装的是不同签名的版本。Android 不允许签名不同的 APK 覆盖安装，需先卸载旧版。

**Q：正式签名后还会提示吗？**
A：会大幅减少，但侧载 APK 仍可能有"未知来源"提示（这是 Android 的通用策略，非针对你的应用）。上架商店可完全消除。

**Q：keystore 密码忘了怎么办？**
A：无法找回，只能生成新 keystore，但**无法覆盖安装**（签名不同），用户需卸载重装。

**Q：可以同时保留调试和正式签名吗？**
A：可以。`development` profile 用调试签名（方便开发），`preview`/`production` 用正式签名（用于分发）。
