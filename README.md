# Smart Palette

智能色阶生成器，使用 **OKLCH 三次样条曲线**拟合，从任意输入颜色生成感知均匀的 11 级色阶（50–950），锚定 Tailwind CSS v4 色彩数据。

## 功能特性

- **OKLCH 曲线拟合**：PCHIP（水平）+ Akima（垂直）样条插值，覆盖 17 个 Tailwind v4 色系，保证单调性与平滑过渡
- **色相感知插值**：圆形样条处理 0°/360° 环绕，色相轮上连续
- **sRGB 色域保护**：OKLCH→RGB 超出 sRGB 时自动降低 Chroma，同时保留 Lightness 与 Hue
- **暗端色相修正**：针对深色输入（L < 60）的可选模式，反向搜索样条找到与输入感知色相一致的基准色相
- **UMD 模块**：浏览器（`<script>`）、Node.js（`require`）、AMD 加载器均可用，零依赖

## 快速开始

### 浏览器

```html
<script src="smart-palette.js"></script>
<script>
  // 基础用法（默认关闭色相修正）
  var result = SmartPalette.tv4SmartMap('#3B82F6');
  console.log(result.palette);
  // { 50: '#EFF6FF', 100: '#DBEAFE', ..., 950: '#172554' }

  // 开启暗端色相修正
  var result2 = SmartPalette.tv4SmartMap('#1E3A5F', true);
  console.log(result2.hueCorrected); // true
</script>
```

### Node.js

```js
var SmartPalette = require('./smart-palette.js');

// 从 HEX 生成色阶
var result = SmartPalette.tv4SmartMap('#3B82F6');
console.log(result.palette[500]);
console.log(result.bestStep);

// 从色相角生成 OKLCH 色阶
var scale = SmartPalette.generateScale(260);
console.log(scale[500]); // [62.31, 0.1880, 259.81]
```

### 旧版 API

```js
// v1 smartMap 接口仍然可用（内部委托给 tv4SmartMap）
var result = SmartPalette.smartMap('#3B82F6');
console.log(result.palette);
```

## API

### `tv4SmartMap(hex, hueCorrection)`

主入口：输入任意 HEX 颜色，返回完整分析结果与 11 级色阶。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `hex` | String | — | `#RRGGBB` 格式的输入色 |
| `hueCorrection` | Boolean | `false` | 启用暗端色相修正 |

返回结果：

| 字段 | 类型 | 说明 |
|------|------|------|
| `bestStep` | Number | 最近的色阶档位（50/100/.../950） |
| `originalL` | Number | 输入的 OKLCH Lightness（0-1） |
| `originalC` | Number | 输入的 OKLCH Chroma |
| `originalH` | Number | 输入的 OKLCH Hue（0-360） |
| `usedHue` | Number | 实际使用的 Hue（修正后或原始） |
| `hueCorrected` | Boolean | 是否应用了暗端色相修正 |
| `isDark` | Boolean | 输入是否为深色（L < 60） |
| `palette` | Object | 11 级色阶，键为档位，值为 HEX |

### `generateScale(hue)`

输入色相角，返回 11 级 OKLCH 参数（不进行色域裁剪）。

返回：`{ 50: [L, C, h], ..., 950: [L, C, h] }`

### `estimateAnchorHue(inputL, inputC, inputH)`

反向搜索样条，找到与深色输入感知色相最匹配的 500 档锚点色相。

返回：`{ anchorHue, bestStep, error }`

### `rgbToOklch(r, g, b)` / `oklchToRgb(l, c, h)`

RGB ↔ OKLCH 转换工具。RGB 通道归一化到 0-1。

### `oklchToRgbInGamut(l, c, h)`

色域保护的 OKLCH→HEX 转换。超出 sRGB 时自动降低 Chroma 保留 Lightness。

## 实现原理

### 第 1 步：提取 Tailwind v4 数据

17 个色系 × 11 级 = 187 个 OKLCH 锚点。

### 第 2 步：PCHIP 水平曲线

对每档位（如 500），用 **PCHIP** 样条横跨 17 个色系的 hue→L/C/h 值。PCHIP 保证单调性，在斜率突变处不过冲（如 Yellow→Lime 的 C 值跳变）。

### 第 3 步：Akima 垂直曲线

每个色系内部（档位→L/C/h），用 **Akima** 样条平滑插值，对离群斜率不敏感。

### 第 4 步：圆形色相插值

色相是周期性的（0°=360°）。算法将色相映射为 cos/sin 分量，分别拟合 PCHIP，再用 atan2 重构。数据扩展 ±360° 保证环绕点连续。

### 第 5 步：色阶生成

输入色相角 → 查询全部 11 条样条曲线 → 获得各级 L/C/h → 色域裁剪 → 输出 HEX 色阶。

### 第 6 步：暗端色相修正（可选）

对深色输入（L < 60），暗端色阶会自然偏移色相。启用时，算法以 0.5° 分辨率在 500-950 档位搜索样条，找到暗端预测色相与输入实际色相最匹配的锚点色相。

## 算法对比

| 算法 | C 值下陷 | 过冲 | 特性 |
|------|----------|------|------|
| 自然三次 | 0.0151（7% 偏差） | 有 | 在斜率突变处振荡 |
| Akima | 0.0014 | 无 | 对离群斜率不敏感，水平轻微下陷 |
| **PCHIP** | **0.0000** | **0.0000** | 保证单调性 |

最终方案：**水平 PCHIP，垂直 Akima**。

## 已知限制

- **0.5° 搜索分辨率**：暗端色相修正使用 0.5° 步进，边界情况可能有 0.25° 误差
- **非 sRGB 色域**：超出 sRGB 的颜色通过降低 Chroma 裁剪，极端颜色可能有轻微失真
- **灰色系**：Slate/Gray/Zinc/Neutral/Stone 不参与拟合（C ≈ 0），仅 17 个彩色系参与

## 参考资料

- Tailwind CSS v4 colors: https://tailwindcss.com/docs/colors
- OKLab / OKLCH 色彩空间: https://bottosson.github.io/posts/oklab/
- PCHIP: Fritsch & Carlson, "Monotone Piecewise Cubic Interpolation", SIAM J. Numer. Anal., 1980
- Akima spline: Akima, "A New Method of Interpolation and Smooth Curve Fitting Based on Local Procedures", JACM, 1970

## 开发者

蓝添 (Dreamanual)

## 许可证

MIT
