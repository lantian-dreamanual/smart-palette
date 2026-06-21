# Smart Palette

基于 tailwind v4 色板的智能色阶配色方案。

这个算法根据任意一个 HEX 颜色，自动生成一套 Tailwind 风格的 11 阶色板（50 ~ 950）。它直接在 **OKLCH** 色彩空间工作，并基于 Tailwind v4 官方色板归纳出参数化模型，生成结果比传统 HSL 色阶更符合人眼感知。

---

## 核心原理

算法在 **OKLCH** 色彩空间中工作。OKLCH 把颜色分成感知亮度（L）、色彩浓度（C）、色相（H）三个分量，其中 L 是人眼感知均匀的，不像 HSL 的 L 只是数学亮度。

整个色阶生成流程分为 7 步：

### 步骤 1：转 OKLCH

输入 HEX 颜色先转换到 OKLCH 空间，得到 `L`（感知亮度）、`C`（饱和度）、`H`（色相）。

```
#99F211 → L=0.871, C=0.237, H=131°
```

### 步骤 2：色相匹配 — 找到专属参考曲线

从 Tailwind v4 的 22 套色系中，根据输入色的色相 `H` 找到色相距离最近的两个**彩色色系**，按色相距离反比插值，得到该色相专属的 L 参考曲线和 C 比率曲线。

```
#99F211, H=131°

最近色系：  lime  (H=131°, 距离=0°)    ← 完全匹配
次近色系：  green (H=150°, 距离=19°)

权重：     lime 100%, green 0%
→ 直接使用 lime 的 L 曲线和 C 比率曲线
```

如果输入色色相落在两个色系之间（如 H=140°，在 lime 131° 和 green 150° 之间），则按距离反比插值：

```
H=140° → lime 距离 9°, green 距离 10°
权重：   lime 53%, green 47%
L_ref[500] = 0.768×0.53 + 0.723×0.47 = 0.747
```

**为什么需要色相匹配？** 旧方案用所有彩色系的平均亮度曲线做参考，但不同色系的亮度差异很大。同样是 500 档：

| 色系 | L 值 |
|------|------|
| Yellow-500 | 0.80 |
| Lime-500 | 0.77 |
| Red-500 | 0.64 |
| Indigo-500 | 0.59 |

平均曲线约 0.65，对 Yellow/Lime 偏暗，对 Indigo 偏亮。色相匹配后每个色相用自己的专属曲线，精度大幅提升。

### 步骤 3：灰彩插值 — 按饱和度混合灰阶与色相曲线

高饱和度颜色因 Helmholtz-Kohlrausch 效应显得更亮，需要更高的 L。低饱和度颜色接近灰色，使用灰阶曲线即可。算法按输入色的 Chroma 在灰阶曲线和色相专属曲线之间插值：

```
chromaFactor = clamp(C / 0.30, 0, 1)

baseL[step] = grayL[step] + chromaFactor × (hueRefL[step] - grayL[step])
```

| 输入色 Chroma | chromaFactor | 灰阶占比 | 色相曲线占比 |
|---|---|---|---|
| 0（纯灰） | 0 | 100% | 0% |
| 0.15（中等） | 0.50 | 50% | 50% |
| 0.30+（鲜艳） | 1.0 | 0% | 100% |

```
#99F211: C=0.237, chromaFactor=0.79

baseL[500] = 0.553 × 0.21 + 0.768 × 0.79 = 0.723
baseL[300] = 0.870 × 0.21 + 0.897 × 0.79 = 0.891
```

灰阶曲线 `SM_GRAY_L` 来自 Tailwind v4 的 Slate/Gray/Zinc/Neutral/Stone 五套无彩色色系的平均值。

### 步骤 4：找自然档位（bestStep）

在 `baseL` 曲线上找到最接近输入色实际 L 值的档位。这个档位就是输入色"自然属于"的位置。

```
#99F211: L=0.871

baseL 曲线：
  50: 0.985   100: 0.970   200: 0.938   300: 0.891
  400: 0.839   500: 0.723  600: 0.622  700: 0.510
  800: 0.428  900: 0.385  950: 0.258

L=0.871 最接近 300 档（0.891）→ bestStep = 300
```

### 步骤 5：锚点校正

以 `bestStep` 为锚点，把输入色的实际 L 钉在该档位上，其他档位按距离二次衰减回归 `baseL`：

```
delta = inputL - baseL[bestStep]
     = 0.871 - 0.891 = -0.020

lTarget[step] = baseL[step] + delta × (1 - (distance/maxDist)²)
```

- 锚点档位（300）：目标 = 输入色实际 L
- 越远离锚点，校正量越小，回归基础曲线
- 二次衰减避免边缘档位被过度拉偏

### 步骤 6：自适应最小间距

sRGB gamma 曲线在极亮和极暗区域严重压缩，同样的 L 差距在中间区域可见，在两端却几乎不可见。算法强制相邻档位之间的 L 间距随距离锚点的增大而放大：

```
minGap = 0.025 × (1 + distFromAnchor × 0.8)
```

| 档位位置 | 要求的最小 L 间距 |
|---|---|
| 锚点附近（500 档） | 0.025 |
| 中等距离（300/700 档） | 0.035 |
| 最远端（50/950 档） | 0.045 |

### 步骤 7：生成色板

用 `lTargets` 的亮度 + 色相专属的 C 比率 × 基准 C + 微调色相 H，逐档生成 OKLCH 再转 RGB。如果颜色超出 sRGB 色域，自动降低 Chroma 保持 L 不变（色域保护）。

```
palette[step] = OKLCH→RGB(
  l = lTargets[step],
  c = baseC × chromaRatios[step],
  h = baseH + 2° × (distance/450)    // 远离锚点轻微偏蓝
)
```

---

## 完整流程图

```
输入 HEX
  │
  ▼
① 转 OKLCH → L, C, H
  │
  ▼
② 色相匹配：在 22 个 Tailwind 色系中找最近两个，
   按色相距离反比插值 → 专属 L 参考曲线 + C 比率曲线
  │
  ▼
③ 灰彩插值：按 C 在灰阶曲线和色相曲线之间插值
   baseL = grayL + chromaFactor × (hueRefL - grayL)
  │
  ▼
④ 找自然档位：在 baseL 上找最接近输入 L 的档位 → bestStep
  │
  ▼
⑤ 锚点校正：以 bestStep 为锚点钉住输入 L，
   其他档位二次衰减回归 baseL
  │
  ▼
⑥ 自适应最小间距：离锚点越远要求越大，补偿 gamma 压缩
  │
  ▼
⑦ 生成色板：lTargets + C 比率 + H 微调，
   色域溢出时自动降 C 保 L
  │
  ▼
输出 11 档色阶 {50, 100, 200, ..., 950}
```

---

## 数据对比

以 Tailwind v4 的 17 套彩色系作为基准，用本算法生成色阶，对比 L 值误差：

| 模型 | 平均 L 误差 | 最大 L 误差 |
|------|----------|----------|
| 固定灰阶目标（改进前） | 0.097 | 0.245 |
| 本算法（改进后） | 0.022 | 0.096 |
| **提升** | **77%** | **61%** |

所有 17 个彩色系的 L 误差全部下降。灰色输入时（C≈0），算法会自动回到灰阶表，结果几乎不变。

部分色系的 500 档对比：

| 色系 | 固定灰阶 L | 本算法 L | Tailwind 实际 L |
|------|----------|---------|----------------|
| Yellow | 0.55 | 0.80 | 0.80 |
| Lime | 0.55 | 0.77 | 0.77 |
| Blue | 0.55 | 0.62 | 0.62 |
| Indigo | 0.55 | 0.59 | 0.59 |
| Red | 0.55 | 0.64 | 0.64 |

---

## 使用方法

### 浏览器

```html
<script src="smart-palette.js"></script>
<script>
  const result = SmartPalette.smartMap('#99F211');
  console.log(result.palette);
  // { 50: '#...', 100: '#...', ..., 950: '#...' }
</script>
```

### Node.js

```js
const { smartMap } = require('./smart-palette.js');

const result = smartMap('#99F211');
console.log(result.palette[500]); // 500 档的 HEX
console.log(result.bestStep);      // 输入色最接近哪个档位
console.log(result.originalL);     // 输入色的 OKLCH L 值
```

### 批量生成

如果你已经有 OKLCH 值，也可以直接生成色阶：

```js
const { generatePalette, getLTargets, getChromaRatios } = require('./smart-palette.js');

const l = 0.80, c = 0.18, h = 90;
const lTargets = getLTargets(l, c, h);
const chromaRatios = getChromaRatios(c, h);
const palette = generatePalette(l, c, h, lTargets, chromaRatios, 500);
```

---

## API 说明

### `smartMap(hex)`

输入任意 HEX 颜色，返回完整分析结果。

| 字段 | 类型 | 说明 |
|------|------|------|
| `bestStep` | Number | 输入色最接近的档位（50/100/.../950） |
| `isExact` | Boolean | 输入色是否已在目标档位上（误差 < 0.02） |
| `originalL` | Number | 输入色的 OKLCH L 值 |
| `originalC` | Number | 输入色的 OKLCH C 值 |
| `originalH` | Number | 输入色的 OKLCH H 值 |
| `adjustedL` | Number | 校正后的目标 L 值 |
| `adjustedHex` | String | 校正后的 HEX 颜色 |
| `originalHex` | String | 原始输入 HEX |
| `palette` | Object | 完整 11 档色阶，键为档位，值为 HEX |
| `lTargets` | Object | 11 档亮度目标 |
| `chromaRatios` | Object | 11 档 Chroma 比率 |
| `baseC` | Number | 锚点档位的 Chroma 推导值 |

### `generatePalette(baseL, baseC, baseH, lTargets, chromaRatios, anchorStep)`

批量生成 11 档色板。通常配合 `getLTargets` 和 `getChromaRatios` 使用。

### `rgbToOklch(r, g, b)` / `oklchToRgb(l, c, h)`

RGB 与 OKLCH 之间的转换工具。RGB 通道归一化到 0~1。

---

## 局限性

- **900 / 950 档仍有轻微误差**：暗色端的 Helmholtz-Kohlrausch 效应更难建模，Tailwind 在这些档位也有大量手工微调。实际视觉差异很小。
- **非 sRGB 色域**：如果 OKLCH 转换结果超出 sRGB 可显示范围，算法会自动降低 Chroma 保持亮度不变，但极端颜色仍可能有轻微失真。
- **色相插值精度**：色相在两个 Tailwind 色系之间线性插值，对于色相间距较大的区间（如 cyan 215° → sky 237°）精度略低于间距小的区间。

---

## 参考

- Tailwind CSS v4 官方色板：`https://tailwindcss.com/docs/colors`
- OKLab / OKLCH 色彩空间：`https://bottosson.github.io/posts/oklab/`
- Helmholtz-Kohlrausch 效应：`https://en.wikipedia.org/wiki/Helmholtz%E2%80%93Kohlrausch_effect`
