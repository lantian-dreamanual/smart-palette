# Smart Palette

基于 tailwind v4 色板的智能色阶配色方案。

这个算法根据任意一个 HEX 颜色，自动生成一套 Tailwind 风格的 11 阶色板（50 ~ 950）。它直接在 **OKLCH** 色彩空间工作，并基于 Tailwind v4 官方色板归纳出参数化模型，生成结果比传统 HSL 色阶更符合人眼感知。

---

## 核心原理

### 1. 在 OKLCH 空间工作，而不是 HSL

HSL 的 `L` 是数学亮度，不是人眼感知亮度。把红色的 HSL 亮度从 50% 拉到 80%，人会看到粉色；把亮度压到 20%，人会看到猪肝色。色相没变，但感知上变了。

OKLCH 把颜色分成三个分量：

| 分量 | 含义 | 范围 |
|------|------|------|
| `L` | 感知亮度（Lightness） | 0 ~ 1 |
| `C` | 色彩浓度（Chroma） | 0 ~ 无上限 |
| `H` | 色相（Hue） | 0° ~ 360° |

在 OKLCH 里固定 `H` 和 `C` 只调 `L`，得到的才是真正“同一种颜色变亮/变暗”的效果。

### 2. 自适应亮度目标：灰阶 + 彩色系双曲线

Tailwind v4 的色板不是用固定公式生成的，而是每套色系手工微调。通过分析 22 套色系可以发现：

- **灰阶色系**（Slate / Gray / Zinc / Neutral / Stone）的 L 分布是最稳定的基准线。
- **彩色系**（Red / Blue / Yellow / …）的 L 值整体更高，因为高饱和度颜色会让人觉得更亮。这个现象叫 **Helmholtz-Kohlrausch 效应**。

例如同样是“500 档”：

| 颜色 | Tailwind v4 的 L 值 |
|------|-------------------|
| Gray-500 | 0.55 |
| Yellow-500 | 0.80 |
| Blue-500 | 0.62 |

本算法用两张亮度表：

- `SM_GRAY_L`：灰阶亮度目标
- `SM_CHROMATIC_L`：彩色系平均亮度目标

根据输入色的 `C` 值在两张表之间插值：

```
chroma_factor = clamp(C / 0.30, 0, 1)
L_target = gray_L + chroma_factor × (chromatic_L - gray_L)
```

`C` 越低越像灰阶，`C` 越高越像彩色系。

### 3. 以输入色为锚点校正

插值出来的亮度曲线在 500 档不一定等于输入色的实际亮度。算法会把输入色作为“锚点”，把整条曲线往它靠拢：

- 500 档（锚点）= 输入色的 L
- 越远离 500 档，越回归基础曲线
- 使用二次衰减（`(distance/450)²`），避免边缘档位被过度拉偏

### 4. 自适应 Chroma 比率曲线

Tailwind 的色阶里，不同饱和度的颜色，Chroma 峰值位置不一样：

- **低饱和度**（C < 0.14）：Chroma 峰值在 400 档
- **中饱和度**（0.14 ≤ C < 0.22）：Chroma 峰值在 500 档
- **高饱和度**（C ≥ 0.22）：Chroma 峰值在 600 档

本算法用三条参考曲线 `SM_CR_LOW` / `SM_CR_MID` / `SM_CR_HIGH`，按输入色的 `C` 值线性插值，生成对应的 11 档 Chroma 比率。

### 5. 锚定 bestStep，而非固定 500 档

传统做法是：无论输入色是深是浅，都从 500 档开始展开整条色阶。这会导致深色输入被硬塞到中间档，浅色输入被硬压到中间档。

本算法先判断输入色最接近哪个档位（`bestStep`），然后以该档位为锚点生成色阶。输入色自身会被保留在正确的位置，其他档位从它自然延伸。

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
  const result = SmartPalette.smartMap('#EAB308');
  console.log(result.palette);
  // { 50: '#...', 100: '#...', ..., 950: '#...' }
</script>
```

### Node.js

```js
const { smartMap } = require('./smart-palette.js');

const result = smartMap('#EAB308');
console.log(result.palette[500]); // 500 档的 HEX
console.log(result.bestStep);      // 输入色最接近哪个档位
console.log(result.originalL);     // 输入色的 OKLCH L 值
```

### 批量生成

如果你已经有 OKLCH 值，也可以直接生成色阶：

```js
const { generatePalette, getLTargets, getChromaRatios } = require('./smart-palette.js');

const l = 0.80, c = 0.18, h = 90;
const lTargets = getLTargets(l, c);
const chromaRatios = getChromaRatios(c);
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
- **Hue 偏移未按色相分组**：算法使用统一的 +2° 蓝色偏移。Tailwind 不同色系的色相偏移差异较大（如 Amber +25°，Blue -5°），但这些差异很难用通用公式替代。
- **非 sRGB 色域**：如果 OKLCH 转换结果超出 sRGB 可显示范围，RGB 会被截断到 0~255。部分极端颜色可能失真。

---

## 参考

- Tailwind CSS v4 官方色板：`https://tailwindcss.com/docs/colors`
- OKLab / OKLCH 色彩空间：`https://bottosson.github.io/posts/oklab/`
- Helmholtz-Kohlrausch 效应：`https://en.wikipedia.org/wiki/Helmholtz%E2%80%93Kohlrausch_effect`
