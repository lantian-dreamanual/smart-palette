---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: 'ef597c7f-44d0-46ff-a9af-92525cb284bd'
  PropagateID: 'ef597c7f-44d0-46ff-a9af-92525cb284bd'
  ReservedCode1: '4d5f4027-362e-47b3-9a1e-5ce442f785b0'
  ReservedCode2: '4d5f4027-362e-47b3-9a1e-5ce442f785b0'
---

# Smart Palette v2

基于 Tailwind v4 色板的智能色阶配色方案，采用 **OKLCH Cubic Spline 曲线拟合** 算法。

输入任意色相角，直接从 17 个 Tailwind V4 色系的拟合曲线上取值，生成 11 阶色板（50 ~ 950）。

---

## v1 → v2 升级要点

| | v1（参数化模型） | v2（曲线拟合模型） |
|---|---|---|
| **核心算法** | 色相匹配 → 灰彩插值 → 锚点校正 | PCHIP/Akima 样条拟合 → 直接取值 |
| **数据来源** | 22 色系的 L 曲线 + C 比率曲线 | 17 色系 × 11 色阶的完整 OKLCH 数据 |
| **横向插值** | 线性插值（最近两色系） | PCHIP（保证单调性，无下凹/overshoot） |
| **纵向插值** | 灰彩混合 + 锚点校正 | Akima（对异常斜率不敏感） |
| **色相环绕** | 不处理 | circularSpline（cos/sin 分量拟合） |
| **暗端色相** | 不处理 | 支持反推基础色相的修正开关 |
| **精度** | 平均 L 误差 0.022 | 精确复现 Tailwind 色系锚点，中间色相科学插值 |

---

## 核心原理

算法在 **OKLCH** 色彩空间中工作。OKLCH 把颜色分成感知亮度（L）、色彩浓度（C）、色相（H）三个分量，其中 L 是人眼感知均匀的。

### 步骤 1：提取 Tailwind V4 原始数据

从 Tailwind CSS v4 的 17 个非灰阶色系（Red, Orange, Amber, ..., Rose）中提取每个色阶 (50-950) 的完整 OKLCH 数据：L、C、h。每个色系有 11 个数据点，共 187 个锚点。

### 步骤 2：构建 PCHIP 横向拟合曲线

对每个色阶（如 500 档），以 17 个色系的 500 档 hue 为 X 轴、L/C/h 为 Y 轴，构建 **PCHIP（Piecewise Cubic Hermite Interpolating Polynomial）** 拟合曲线。

PCHIP 的关键特性：**保证单调性**。在斜率突变处（如 Yellow → Lime 的 C 值跳变），PCHIP 不会产生 overshoot 或 undershoot，而自然三次样条在这些位置会产生严重的下凹。

```
500 档的 C 值曲线（示例）：

自然三次样条：
  Blue(0.188) → Purple(0.232) ← 此处 C 值下凹，最低可到 0.173

PCHIP：
  Blue(0.188) → Purple(0.232) ← 单调递增，无下凹
```

### 步骤 3：构建 Akima 纵向平滑曲线

纵向曲线（同一色系内，step→L/C/h）使用 **Akima 样条**。Akima 对异常斜率不敏感，在数据点密集且平滑的区域表现优秀。它不会像自然三次样条那样在远处异常值的影响下产生全局振荡。

### 步骤 4：循环插值处理色相环绕

色相是周期性的（0° = 360°）。将色相映射到 cos/sin 分量，分别用 PCHIP 拟合，再通过 atan2 还原回角度。同时将数据扩展 ±360°，确保色相环绕处的插值连续。

### 步骤 5：查询生成色板

输入任意色相角 (0-360°)，在每条拟合曲线上查询对应的 L、C、h 值，即可生成 11 阶色板。

### 步骤 6：暗端色相修正（可选）

深色输入（L < 60）时，暗端色阶的色相会自然漂移（这是 Tailwind 色板的特性）。开启修正后，算法在暗端色阶 (500-950) 的样条曲线上搜索，反推哪个 500 档锚点色相会产生最接近输入色的暗端色相，使暗端色阶与输入色色相一致。

---

## 完整流程图

```
输入 HEX 颜色
  │
  ▼
① 转 OKLCH → L, C, H
  │
  ▼
② 暗端色相修正（可选）
  │  深色 + 开关开启 → 在暗端样条上搜索
  │  反推基础色相 anchorHue
  │
  ▼
③ 在 PCHIP/Akima 拟合曲线上查询
  │  每个 step: splineL[hue], splineC[hue], splineH[hue]
  │  → 得到 OKLCH 参数
  │
  ▼
④ 色域保护：超出 sRGB 时自动降 C 保 L
  │
  ▼
⑤ 找到最匹配的色阶档位 bestStep
  │
  ▼
输出 11 档色阶 {50, 100, 200, ..., 950}
```

---

## 使用方法

### 浏览器

```html
<script src="smart-palette.js"></script>
<script>
  // 基本用法（暗端色相修正默认关闭）
  const result = SmartPalette.tv4SmartMap('#3B82F6');
  console.log(result.palette);
  // { 50: '#EFF6FF', 100: '#DBEAFE', ..., 950: '#172554' }

  // 开启暗端色相修正
  const result2 = SmartPalette.tv4SmartMap('#1E3A5F', true);
  console.log(result2.hueCorrected); // true —— 色相已被修正
</script>
```

### Node.js

```js
const { tv4SmartMap, generateScale } = require('./smart-palette.js');

// 输入 HEX 颜色生成色板
const result = tv4SmartMap('#3B82F6');
console.log(result.palette[500]);   // 500 档的 HEX
console.log(result.bestStep);        // 输入色最接近哪个档位
console.log(result.originalL);       // 输入色的 OKLCH L 值

// 输入色相角生成 OKLCH 参数
const scale = generateScale(260);    // Blue 色相
console.log(scale[500]);             // [62.31, 0.1880, 259.81]
```

### 旧版 API 兼容

```js
// v1 的 smartMap 接口仍然可用（内部调用 tv4SmartMap）
const result = SmartPalette.smartMap('#3B82F6');
console.log(result.palette);
```

---

## API 说明

### `tv4SmartMap(hex, hueCorrection)`

主入口：输入任意 HEX 颜色，返回完整分析结果。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `hex` | String | — | 输入颜色，格式 `#RRGGBB` |
| `hueCorrection` | Boolean | `false` | 是否开启暗端色相修正 |

返回对象：

| 字段 | 类型 | 说明 |
|------|------|------|
| `bestStep` | Number | 输入色最接近的档位（50/100/.../950） |
| `originalL` | Number | 输入色的 OKLCH L 值 (0-1) |
| `originalC` | Number | 输入色的 OKLCH C 值 |
| `originalH` | Number | 输入色的 OKLCH H 值 (0-360) |
| `usedHue` | Number | 实际使用的色相（修正后的基础色相或原始色相） |
| `hueCorrected` | Boolean | 是否进行了暗端色相修正 |
| `isDark` | Boolean | 输入色是否为深色 (L < 60) |
| `palette` | Object | 完整 11 档色阶，键为档位，值为 HEX |

### `generateScale(hue)`

输入色相角，返回 11 色阶的 OKLCH 参数（不经过色域保护）。

| 参数 | 类型 | 说明 |
|------|------|------|
| `hue` | Number | 色相角，范围 0-360 |

返回：`{ 50: [L, C, h], 100: [L, C, h], ..., 950: [L, C, h] }`（L: 0-100, C: >=0, h: 0-360）

### `estimateAnchorHue(inputL, inputC, inputH)`

从输入颜色反推其最可能对应的 500 档色相（暗端色相修正用）。

返回：`{ anchorHue, bestStep, error }`

### `rgbToOklch(r, g, b)` / `oklchToRgb(l, c, h)`

RGB 与 OKLCH 之间的转换工具。RGB 通道归一化到 0~1。

### `oklchToRgbInGamut(l, c, h)`

色域保护版本的 OKLCH→HEX 转换。超出 sRGB 色域时自动降低 Chroma 保持亮度不变。

---

## 插值算法对比

在 Tailwind V4 色系的横向 C 值曲线上，三种插值算法的表现：

| 算法 | C 值 sag（下凹） | overshoot | 特点 |
|------|-----------------|-----------|------|
| 自然三次样条 | 0.0151（7%偏差） | 有 | 斜率突变处产生振荡 |
| Akima | 0.0014 | 无 | 对异常斜率不敏感，但横向曲线仍有轻微下凹 |
| **PCHIP** | **0.0000** | **0.0000** | 保证单调性，无下凹/overshoot |

最终方案：**横向用 PCHIP，纵向用 Akima**。

---

## 局限性

- **0.5° 搜索精度**：暗端色相修正使用 0.5° 步进搜索，极端情况下可能有 0.25° 以内的误差。
- **非 sRGB 色域**：OKLCH 转 RGB 时如果超出 sRGB 可显示范围，算法会自动降低 Chroma 保持亮度不变，但极端颜色仍可能有轻微失真。
- **灰阶色系**：Slate/Gray/Zinc/Neutral/Stone 五个灰阶色系未参与拟合（C≈0），仅基于 17 个彩色色系。

---

## 参考

- Tailwind CSS v4 官方色板：`https://tailwindcss.com/docs/colors`
- OKLab / OKLCH 色彩空间：`https://bottosson.github.io/posts/oklab/`
- PCHIP 算法：Fritsch & Carlson, "Monotone Piecewise Cubic Interpolation", SIAM J. Numer. Anal., 1980
- Akima 样条：Akima, "A New Method of Interpolation and Smooth Curve Fitting Based on Local Procedures", JACM, 1970

> AI生成