(function (root, factory) {
  // UMD 模块封装：同时支持浏览器、Node.js 和 AMD 加载器
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.SmartPalette = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ============================================================
  //  Smart Palette — 基于 Tailwind v4 色板结构的智能色阶生成器
  // ============================================================
  // 核心思路：
  // 1. 在 OKLCH 色彩空间工作，而非 RGB 或 HSL。
  // 2. 根据输入色的饱和度（Chroma）自适应选择亮度曲线。
  // 3. 根据输入色的饱和度自适应选择 Chroma 衰减曲线。
  // 4. 以输入色实际映射到的档位为锚点，生成完整 11 阶色板。
  //
  // 为什么用 OKLCH？
  // OKLCH 的 L（Lightness）是感知均匀的，而 HSL 的 L 是数学亮度。
  // 把红色只调 HSL 的 L 会变粉/变猪肝，但 OKLCH 固定色相和 Chroma 只调 L，
  // 得到的是真正的“同一种颜色变亮/变暗”。
  // ============================================================

  // ===== 档位序列 =====
  // Tailwind 风格的标准色阶，从 50（最浅）到 950（最深）。
  const SM_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

  // ===== 灰阶亮度目标表 =====
  // 来源：Tailwind v4 的 Slate / Gray / Zinc / Neutral / Stone 五套无彩色色系的平均 L 值。
  // 这些颜色饱和度≈0，不存在 Helmholtz-Kohlrausch 效应，所以它们的 L 分布
  // 可以当作"人眼感知亮度"的基准线。
  // 当输入色接近灰色时，算法会 100% 使用这张表。
  const SM_GRAY_L = {
    50: 0.9848, 100: 0.9684, 200: 0.9244, 300: 0.8702, 400: 0.7066,
    500: 0.5532, 600: 0.4434, 700: 0.3720, 800: 0.2736, 900: 0.2098, 950: 0.1384
  };

  // ===== 色相感知参考曲线 =====
  // 来源：Tailwind CSS v4 的 22 套色系，每套取其 500 档色相为代表，
  // 并记录每个档位 OKLCH 的 L 值和 C 相对 500 档的比率。
  // 对任意输入色，根据色相在相邻两个色系之间插值，得到专属的参考曲线。
  // 这比单一"灰阶/彩色平均曲线"更准确，尤其是 lime/yellow 等高亮色系。
  const SM_FAMILIES = [
    { name: 'slate', hue: 257.417, l: {50:0.9840,100:0.9680,200:0.9290,300:0.8690,400:0.7040,500:0.5540,600:0.4460,700:0.3720,800:0.2790,900:0.2080,950:0.1290}, cr: {50:0.065,100:0.152,200:0.283,300:0.478,400:0.870,500:1.000,600:0.935,700:0.957,800:0.891,900:0.913,950:0.913} },
    { name: 'gray', hue: 264.364, l: {50:0.9850,100:0.9670,200:0.9280,300:0.8720,400:0.7070,500:0.5510,600:0.4460,700:0.3730,800:0.2780,900:0.2100,950:0.1300}, cr: {50:0.074,100:0.111,200:0.222,300:0.370,400:0.815,500:1.000,600:1.111,700:1.259,800:1.222,900:1.259,950:1.037} },
    { name: 'zinc', hue: 285.938, l: {50:0.9850,100:0.9670,200:0.9200,300:0.8710,400:0.7050,500:0.5520,600:0.4420,700:0.3700,800:0.2740,900:0.2100,950:0.1410}, cr: {50:0.000,100:0.062,200:0.250,300:0.375,400:0.938,500:1.000,600:1.062,700:0.812,800:0.375,900:0.375,950:0.312} },
    { name: 'neutral', hue: 0.000, l: {50:0.9850,100:0.9700,200:0.9220,300:0.8700,400:0.7080,500:0.5560,600:0.4390,700:0.3710,800:0.2690,900:0.2050,950:0.1450}, cr: {50:0.200,100:0.289,200:0.467,300:0.644,400:0.822,500:1.000,600:0.822,700:0.644,800:0.467,900:0.289,950:0.200} },
    { name: 'stone', hue: 58.071, l: {50:0.9850,100:0.9700,200:0.9230,300:0.8690,400:0.7090,500:0.5530,600:0.4440,700:0.3740,800:0.2680,900:0.2160,950:0.1470}, cr: {50:0.077,100:0.077,200:0.231,300:0.385,400:0.769,500:1.000,600:0.846,700:0.769,800:0.538,900:0.462,950:0.308} },
    { name: 'red', hue: 25.331, l: {50:0.9710,100:0.9360,200:0.8850,300:0.8080,400:0.7040,500:0.6370,600:0.5770,700:0.5050,800:0.4440,900:0.3960,950:0.2580}, cr: {50:0.055,100:0.135,200:0.262,300:0.481,400:0.806,500:1.000,600:1.034,700:0.899,800:0.747,900:0.595,950:0.388} },
    { name: 'orange', hue: 47.604, l: {50:0.9800,100:0.9540,200:0.9010,300:0.8370,400:0.7500,500:0.7050,600:0.6460,700:0.5530,800:0.4700,900:0.4080,950:0.2660}, cr: {50:0.075,100:0.178,200:0.357,300:0.601,400:0.859,500:1.000,600:1.042,700:0.915,800:0.737,900:0.577,950:0.371} },
    { name: 'amber', hue: 70.080, l: {50:0.9870,100:0.9620,200:0.9240,300:0.8790,400:0.8280,500:0.7690,600:0.6660,700:0.5550,800:0.4730,900:0.4140,950:0.2790}, cr: {50:0.117,100:0.314,200:0.638,300:0.899,400:1.005,500:1.000,600:0.952,700:0.867,800:0.729,900:0.596,950:0.410} },
    { name: 'yellow', hue: 86.047, l: {50:0.9870,100:0.9730,200:0.9450,300:0.9050,400:0.8520,500:0.7950,600:0.6810,700:0.5540,800:0.4760,900:0.4210,950:0.2860}, cr: {50:0.141,100:0.386,200:0.701,300:0.989,400:1.082,500:1.000,600:0.880,700:0.734,800:0.620,900:0.516,950:0.359} },
    { name: 'lime', hue: 130.850, l: {50:0.9860,100:0.9670,200:0.9380,300:0.8970,400:0.8410,500:0.7680,600:0.6480,700:0.5320,800:0.4530,900:0.4050,950:0.2740}, cr: {50:0.133,100:0.288,200:0.545,300:0.841,400:1.021,500:1.000,600:0.858,700:0.674,800:0.532,900:0.433,950:0.309} },
    { name: 'green', hue: 149.579, l: {50:0.9820,100:0.9620,200:0.9250,300:0.8710,400:0.7920,500:0.7230,600:0.6270,700:0.5270,800:0.4480,900:0.3930,950:0.2660}, cr: {50:0.082,100:0.201,200:0.384,300:0.685,400:0.954,500:1.000,600:0.886,700:0.703,800:0.543,900:0.434,950:0.297} },
    { name: 'emerald', hue: 162.480, l: {50:0.9790,100:0.9500,200:0.9050,300:0.8450,400:0.7650,500:0.6960,600:0.5960,700:0.5080,800:0.4320,900:0.3780,950:0.2620}, cr: {50:0.124,100:0.306,200:0.547,300:0.841,400:1.041,500:1.000,600:0.853,700:0.694,800:0.559,900:0.453,950:0.300} },
    { name: 'teal', hue: 182.503, l: {50:0.9840,100:0.9530,200:0.9100,300:0.8550,400:0.7770,500:0.7040,600:0.6000,700:0.5110,800:0.4370,900:0.3860,950:0.2770}, cr: {50:0.100,100:0.364,200:0.686,300:0.986,400:1.086,500:1.000,600:0.843,700:0.686,800:0.557,900:0.450,950:0.329} },
    { name: 'cyan', hue: 215.221, l: {50:0.9840,100:0.9560,200:0.9170,300:0.8650,400:0.7890,500:0.7150,600:0.6090,700:0.5200,800:0.4500,900:0.3980,950:0.3020}, cr: {50:0.133,100:0.315,200:0.559,300:0.888,400:1.077,500:1.000,600:0.881,700:0.734,800:0.594,900:0.490,950:0.392} },
    { name: 'sky', hue: 237.323, l: {50:0.9770,100:0.9510,200:0.9010,300:0.8280,400:0.7460,500:0.6850,600:0.5880,700:0.5000,800:0.4430,900:0.3910,950:0.2930}, cr: {50:0.077,100:0.154,200:0.343,300:0.657,400:0.947,500:1.000,600:0.935,700:0.793,800:0.651,900:0.533,950:0.391} },
    { name: 'blue', hue: 259.815, l: {50:0.9700,100:0.9320,200:0.8820,300:0.8090,400:0.7070,500:0.6230,600:0.5460,700:0.4880,800:0.4240,900:0.3790,950:0.2820}, cr: {50:0.065,100:0.150,200:0.276,300:0.491,400:0.771,500:1.000,600:1.145,700:1.136,800:0.930,900:0.682,950:0.425} },
    { name: 'indigo', hue: 277.117, l: {50:0.9620,100:0.9300,200:0.8700,300:0.7850,400:0.6730,500:0.5850,600:0.5110,700:0.4570,800:0.3980,900:0.3590,950:0.2570}, cr: {50:0.077,100:0.146,200:0.279,300:0.494,400:0.781,500:1.000,600:1.124,700:1.030,800:0.837,900:0.618,950:0.386} },
    { name: 'violet', hue: 292.717, l: {50:0.9690,100:0.9430,200:0.8940,300:0.8110,400:0.7020,500:0.6060,600:0.5410,700:0.4910,800:0.4320,900:0.3800,950:0.2830}, cr: {50:0.064,100:0.116,200:0.228,300:0.444,400:0.732,500:1.000,600:1.124,700:1.080,800:0.928,900:0.756,950:0.564} },
    { name: 'purple', hue: 303.900, l: {50:0.9770,100:0.9460,200:0.9020,300:0.8270,400:0.7140,500:0.6270,600:0.5580,700:0.4960,800:0.4380,900:0.3810,950:0.2910}, cr: {50:0.053,100:0.125,200:0.238,300:0.449,400:0.766,500:1.000,600:1.087,700:1.000,800:0.823,900:0.664,950:0.562} },
    { name: 'fuchsia', hue: 322.150, l: {50:0.9770,100:0.9520,200:0.9030,300:0.8330,400:0.7400,500:0.6670,600:0.5910,700:0.5180,800:0.4520,900:0.4010,950:0.2930}, cr: {50:0.058,100:0.125,200:0.258,300:0.492,400:0.807,500:1.000,600:0.993,700:0.858,800:0.715,900:0.576,950:0.461} },
    { name: 'pink', hue: 354.308, l: {50:0.9710,100:0.9480,200:0.8990,300:0.8230,400:0.7180,500:0.6560,600:0.5920,700:0.5250,800:0.4590,900:0.4080,950:0.2840}, cr: {50:0.058,100:0.116,200:0.253,300:0.498,400:0.838,500:1.000,600:1.033,700:0.925,800:0.776,900:0.635,950:0.452} },
    { name: 'rose', hue: 16.439, l: {50:0.9690,100:0.9410,200:0.8920,300:0.8100,400:0.7120,500:0.6450,600:0.5860,700:0.5140,800:0.4550,900:0.4100,950:0.2710}, cr: {50:0.061,100:0.122,200:0.236,300:0.476,400:0.789,500:1.000,600:1.028,700:0.902,800:0.764,900:0.646,950:0.427} }
  ];

  // 色相环形距离：取 [0, 360) 内最短弧长
  function _hueDistance(h1, h2) {
    var d = Math.abs(h1 - h2) % 360;
    return d > 180 ? 360 - d : d;
  }

  // 根据输入色的色相，在 SM_FAMILIES 中找到最近的两个彩色色系并插值，
  // 返回该色相专属的 L 参考曲线和 C 比率曲线。
  // 灰色系（slate/gray/zinc/neutral/stone）不参与色相匹配。
  function smGetHueRefCurves(hue) {
    var chromatic = SM_FAMILIES.filter(function (f) {
      return f.name !== 'slate' && f.name !== 'gray' && f.name !== 'zinc' &&
             f.name !== 'neutral' && f.name !== 'stone';
    });

    // 按色相距离排序
    var sorted = chromatic.map(function (f) {
      return { family: f, dist: _hueDistance(hue, f.hue) };
    }).sort(function (a, b) { return a.dist - b.dist; });

    var f1 = sorted[0].family;
    var f2 = sorted[1].family;
    var d1 = sorted[0].dist;
    var d2 = sorted[1].dist;

    // 如果完全匹配某个色系，直接返回
    if (d1 === 0) {
      return { l: f1.l, cr: f1.cr };
    }

    // 在两个色系之间按色相距离反比插值
    var w1 = d2 / (d1 + d2);
    var w2 = d1 / (d1 + d2);

    var l = {}, cr = {};
    SM_STEPS.forEach(function (step) {
      l[step] = f1.l[step] * w1 + f2.l[step] * w2;
      cr[step] = f1.cr[step] * w1 + f2.cr[step] * w2;
    });

    return { l: l, cr: cr };
  }

  // ===== 内部辅助函数 =====
  // 这些函数负责在 HEX、RGB、Linear RGB、XYZ、OKLab、OKLCH 之间转换。
  // 大部分代码来自 https://bottosson.github.io/posts/oklab/ 的参考实现。

  // 将 HEX 字符串解析为 RGB 对象，每个通道归一化到 0~1。
  function _hexToRgb(hex) {
    const hexClean = hex.replace('#', '');
    const hex6 = hexClean.length === 3
      ? hexClean[0] + hexClean[0] + hexClean[1] + hexClean[1] + hexClean[2] + hexClean[2]
      : hexClean;
    return {
      r: parseInt(hex6.substring(0, 2), 16) / 255,
      g: parseInt(hex6.substring(2, 4), 16) / 255,
      b: parseInt(hex6.substring(4, 6), 16) / 255
    };
  }

  // 将 RGB 对象转换为 HEX 字符串，带 0 填充。
  function _rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (x) {
      return Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
    }).join('');
  }

  // sRGB 的 gamma 校正：从 sRGB 到线性 RGB。
  function _toLinear(x) {
    return x >= 0.04045 ? Math.pow((x + 0.055) / 1.055, 2.4) : x / 12.92;
  }

  // sRGB 的 gamma 校正：从线性 RGB 到 sRGB。
  function _fromLinear(x) {
    return x >= 0.0031308 ? 1.055 * Math.pow(x, 1 / 2.4) - 0.055 : 12.92 * x;
  }

  // 将 RGB 转换为 OKLCH。
  // 先转线性 RGB，再乘合并的 RGB→LMS 矩阵（sRGB→XYZ 和 XYZ→LMS 两步合并后的系数），
  // 然后 cube root 转非线性 LMS，再乘 LMS→OKLab 矩阵，最后转极坐标（LCH）。
  // 注意：不能把 XYZ→LMS 矩阵直接乘线性 RGB，必须用合并后的 RGB→LMS 矩阵。
  function smRgbToOklch(r, g, b) {
    const lr = _toLinear(r);
    const lg = _toLinear(g);
    const lb = _toLinear(b);

    // 合并的 sRGB→LMS 矩阵（来自 OKLab 规范）
    const lms = {
      l: 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
      m: 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
      s: 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb
    };

    const lms_ = {
      l: Math.cbrt(lms.l),
      m: Math.cbrt(lms.m),
      s: Math.cbrt(lms.s)
    };

    const lab = {
      l: 0.2104542553 * lms_.l + 0.7936177850 * lms_.m - 0.0040720468 * lms_.s,
      a: 1.9779984951 * lms_.l - 2.4285922050 * lms_.m + 0.4505937099 * lms_.s,
      b: 0.0259040371 * lms_.l + 0.7827717662 * lms_.m - 0.8086757660 * lms_.s
    };

    const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
    if (h < 0) h += 360;

    return { l: lab.l, c: c, h: h };
  }

  // 将 OKLCH 转换为 RGB。
  function smOklchToRgb(l, c, h) {
    const hRad = (h * Math.PI) / 180;
    const a = c * Math.cos(hRad);
    const b = c * Math.sin(hRad);

    const lms_ = {
      l: l + 0.3963377774 * a + 0.2158037573 * b,
      m: l - 0.1055613458 * a - 0.0638541728 * b,
      s: l - 0.0894841775 * a - 1.2914855480 * b
    };

    const lms = {
      l: lms_.l * lms_.l * lms_.l,
      m: lms_.m * lms_.m * lms_.m,
      s: lms_.s * lms_.s * lms_.s
    };

    const rgb = {
      r: 4.0767416621 * lms.l - 3.3077115913 * lms.m + 0.2309699292 * lms.s,
      g: -1.2684380046 * lms.l + 2.6097574011 * lms.m - 0.3413193965 * lms.s,
      b: -0.0041960863 * lms.l - 0.7034186147 * lms.m + 1.7076147010 * lms.s
    };

    return {
      r: Math.round(_fromLinear(rgb.r) * 255),
      g: Math.round(_fromLinear(rgb.g) * 255),
      b: Math.round(_fromLinear(rgb.b) * 255)
    };
  }

  // ===== 核心算法：自适应亮度目标 =====
  // 输入：当前颜色的 L（感知亮度）和 C（饱和度）
  // 输出：11 个档位的目标 L 值
  //
  // 步骤：
  // 1. 根据 C 值在灰阶曲线（SM_GRAY_L）和彩色系曲线（SM_CHROMATIC_L）之间插值。
  //    chroma_factor = clamp(C / 0.30, 0, 1)
  //    C 越小越用灰阶表，C 越大越用彩色系表。
  // 2. 以输入色的实际 L 为锚点做校正（锚点档位 = 输入色最匹配的档位）：
  //    锚点档位的目标 L = 输入色的实际 L
  //    其他档位按到锚点的距离衰减，回归基础曲线
  //
  //    关键改进：不再硬编码 500 档为锚点。
  //    如果输入色很暗（L=0.27），自然属于 800-950 范围，
  //    以 500 为锚点会整条曲线向下拉 -0.27，导致暗端被压缩到纯黑。
  //    改用 bestStep 为锚点后，暗色在暗端展开，亮色在亮端展开。
  // 以 anchorStep 档位为锚点，生成 L 目标曲线（内部函数）
  // hueRefL: 该色相专属的 L 参考曲线（由 smGetHueRefCurves 返回的 l 对象）
  // inputC: 输入色的 Chroma，用于在灰阶曲线和色相曲线之间插值
  function _smGetLTargetsWithAnchor(inputL, inputC, anchorStep, hueRefL) {
    var chromaFactor = Math.min(Math.max(inputC / 0.30, 0), 1);

    var baseL = {};
    SM_STEPS.forEach(function (step) {
      baseL[step] = SM_GRAY_L[step] + chromaFactor * (hueRefL[step] - SM_GRAY_L[step]);
    });

    const deltaAtAnchor = inputL - baseL[anchorStep];
    const maxDist = Math.max(anchorStep - SM_STEPS[0], SM_STEPS[SM_STEPS.length - 1] - anchorStep);
    const safeMaxDist = maxDist > 0 ? maxDist : 450;

    const targets = {};
    SM_STEPS.forEach(function (step) {
      const t = Math.abs(step - anchorStep) / safeMaxDist;
      const decay = t * t;
      let l = baseL[step] + deltaAtAnchor * (1 - decay);
      l = Math.max(0.01, Math.min(0.99, l));
      targets[step] = l;
    });

    // 自适应最小间距（补偿 sRGB gamma 压缩）
    const BASE_GAP = 0.025;
    const GAP_SCALE = 0.8;
    for (let i = 1; i < SM_STEPS.length; i++) {
      const distFromAnchor = Math.abs(SM_STEPS[i] - anchorStep) / safeMaxDist;
      const minGap = BASE_GAP * (1 + distFromAnchor * GAP_SCALE);
      const maxL = targets[SM_STEPS[i - 1]] - minGap;
      if (targets[SM_STEPS[i]] > maxL) {
        targets[SM_STEPS[i]] = Math.max(maxL, 0.01);
      }
    }

    return targets;
  }

  function smGetLTargets(inputL, inputC, hue) {
    // 根据色相获取专属参考曲线
    var hueRef = smGetHueRefCurves(hue || 0);
    var hueRefL = hueRef.l;

    // 两阶段锚点定位：
    //   第一轮：基于原始插值曲线（无锚点校正）找到输入色自然属于哪个档位
    //   第二轮：以该档位为锚点做校正，让整条曲线围绕输入色自然展开
    var chromaFactor = Math.min(Math.max(inputC / 0.30, 0), 1);

    var rawBaseL = {};
    SM_STEPS.forEach(function (step) {
      rawBaseL[step] = SM_GRAY_L[step] + chromaFactor * (hueRefL[step] - SM_GRAY_L[step]);
    });

    var bestStep = 500;
    var minDiff = Infinity;
    SM_STEPS.forEach(function (step) {
      var diff = Math.abs(inputL - rawBaseL[step]);
      if (diff < minDiff) {
        minDiff = diff;
        bestStep = step;
      }
    });

    return _smGetLTargetsWithAnchor(inputL, inputC, bestStep, hueRefL);
  }

  // ===== 核心算法：色相感知 Chroma 比率 =====
  // 输入：当前颜色的 C（饱和度）和色相 H
  // 输出：11 个档位的 Chroma 相对比率
  //
  // 直接使用该色相最近的 Tailwind 色系的 C 衰减曲线，
  // 比 LOW/MID/HIGH 三曲线插值更精确。
  function smGetChromaRatios(inputC, hue) {
    var hueRef = smGetHueRefCurves(hue || 0);
    return hueRef.cr;
  }

  // ===== 智能色阶映射 =====
  // 输入：任意 HEX 颜色
  // 输出：该颜色在 11 档色阶中应该位于哪个档位，以及完整生成的色板
  //
  // 返回对象包含：
  //   bestStep      最接近的档位（50/100/.../950）
  //   isExact       输入色是否已经接近该档位（差距 < 0.02）
  //   originalL/C/H 输入色的 OKLCH 分量
  //   adjustedL     输入色校正后的目标 L
  //   adjustedHex   输入色校正后的 HEX
  //   palette       完整 11 档色阶，每个值是 HEX
  //   lTargets      11 档亮度目标（用于调试/可视化）
  //   chromaRatios  11 档 Chroma 比率（用于调试/可视化）
  function smSmartMap(hex) {
    const rgb = _hexToRgb(hex);
    const oklch = smRgbToOklch(rgb.r, rgb.g, rgb.b);
    const l = oklch.l;
    const c = oklch.c;
    const h = oklch.h;

    // 两阶段锚点定位（由 smGetLTargets 内部完成）：
    //   基于色相感知曲线找 bestStep → 以 bestStep 为锚点生成 L 目标
    const lTargets = smGetLTargets(l, c, h);

    // 从 lTargets 中提取 bestStep（smGetLTargets 已确定）
    let bestStep = 500;
    let minDiff = Infinity;
    SM_STEPS.forEach(function (step) {
      const diff = Math.abs(l - lTargets[step]);
      if (diff < minDiff) {
        minDiff = diff;
        bestStep = step;
      }
    });

    const targetL = lTargets[bestStep];
    const isExact = minDiff < 0.02;

    const adjustedRgb = isExact
      ? { r: Math.round(rgb.r * 255), g: Math.round(rgb.g * 255), b: Math.round(rgb.b * 255) }
      : smOklchToRgb(targetL, c, h);
    const adjustedHex = _rgbToHex(adjustedRgb.r, adjustedRgb.g, adjustedRgb.b);

    const chromaRatios = smGetChromaRatios(c, h);
    const baseC = c / Math.max(0.01, chromaRatios[bestStep]);
    const palette = smGeneratePalette(targetL, baseC, h, lTargets, chromaRatios, bestStep);

    // 锚点档位使用校正后的输入色，保证原色不被替换
    palette[bestStep] = adjustedHex;

    return {
      bestStep: bestStep,
      isExact: isExact,
      originalL: l,
      originalC: c,
      originalH: h,
      adjustedL: targetL,
      adjustedHex: adjustedHex,
      originalHex: hex,
      palette: palette,
      lTargets: lTargets,
      chromaRatios: chromaRatios,
      baseC: baseC
    };
  }

  // ===== 色域保护 =====
  // OKLCH 颜色转换到 sRGB 时，如果某些通道超出 [0, 255]，说明该颜色
  // 无法在屏幕上显示。直接 clamp 会严重扭曲亮度和色相。
  // 正确做法：保持 L 和 H 不变，降低 C 直到颜色刚好在色域边界上。
  // 这样色阶的亮度单调递减不会被色域裁剪 + HK 效应破坏。
  function _oklchToRgbInGamut(l, c, h) {
    let currentC = Math.max(0, c);
    while (currentC > 0.001) {
      const hRad = (h * Math.PI) / 180;
      const a = currentC * Math.cos(hRad);
      const b = currentC * Math.sin(hRad);

      const lms_ = {
        l: l + 0.3963377774 * a + 0.2158037573 * b,
        m: l - 0.1055613458 * a - 0.0638541728 * b,
        s: l - 0.0894841775 * a - 1.2914855480 * b
      };

      const lms = {
        l: lms_.l * lms_.l * lms_.l,
        m: lms_.m * lms_.m * lms_.m,
        s: lms_.s * lms_.s * lms_.s
      };

      // 计算线性 RGB（未经 gamma 校正）
      const lr = 4.0767416621 * lms.l - 3.3077115913 * lms.m + 0.2309699292 * lms.s;
      const lg = -1.2684380046 * lms.l + 2.6097574011 * lms.m - 0.3413193965 * lms.s;
      const lb = -0.0041960863 * lms.l - 0.7034186147 * lms.m + 1.7076147010 * lms.s;

      // 检查是否在 sRGB 色域内（微小容差容纳浮点误差）
      if (lr >= -0.001 && lr <= 1.001 && lg >= -0.001 && lg <= 1.001 && lb >= -0.001 && lb <= 1.001) {
        // 在色域内 → 正常转换并 clamp
        const r = Math.round(Math.max(0, Math.min(255, _fromLinear(Math.max(0, Math.min(1, lr))) * 255)));
        const g = Math.round(Math.max(0, Math.min(255, _fromLinear(Math.max(0, Math.min(1, lg))) * 255)));
        const b = Math.round(Math.max(0, Math.min(255, _fromLinear(Math.max(0, Math.min(1, lb))) * 255)));
        return _rgbToHex(r, g, b);
      }

      // 超出色域 → 降低 Chroma 8%，保留 L 和 H
      currentC *= 0.92;
    }

    // 色域极限：Chroma 降到极低值仍不在色域（极端 L 值），用纯灰色
    const rgb = smOklchToRgb(Math.max(0.01, Math.min(0.99, l)), 0, h);
    return _rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  // ===== 生成完整色板 =====
  // 根据输入色推导出的参数，生成 11 档色阶。
  //
  // 参数：
  //   baseL        锚点档位的亮度
  //   baseC        锚点档位的 Chroma
  //   baseH        锚点档位的色相
  //   lTargets     11 档亮度目标
  //   chromaRatios 11 档 Chroma 比率
  //   anchorStep   锚点档位（如 800）
  function smGeneratePalette(baseL, baseC, baseH, lTargets, chromaRatios, anchorStep) {
    const palette = {};
    SM_STEPS.forEach(function (step) {
      // 直接使用 lTargets 中已计算好的目标亮度，不再做 anchor blend 二次插值
      const l = lTargets[step];

      // 色相偏移：远离锚点时向蓝色轻微偏移 +2°
      const t = Math.abs(step - anchorStep) / 450;
      const h = (baseH + 2 * t + 360) % 360;

      // Chroma：锚点档位使用基准值，其他档位按比率衰减
      const c = step === anchorStep ? baseC : baseC * chromaRatios[step];

      // 色域保护：超出 sRGB 时自动降低 Chroma，确保实际亮度单调递减
      palette[step] = _oklchToRgbInGamut(
        Math.max(0, Math.min(1, l)),
        Math.max(0, c),
        h
      );
    });
    return palette;
  }

  // ===== 对外暴露的 API =====
  // 在浏览器中通过 SmartPalette.xxx 调用；在 Node 中通过 require 解构。
  return {
    // 核心入口：输入 HEX，返回完整分析结果 + 色板
    smartMap: smSmartMap,

    // 批量生成：输入 OKLCH 参数，返回 11 档色板
    generatePalette: smGeneratePalette,

    // 颜色空间转换工具
    rgbToOklch: smRgbToOklch,
    oklchToRgb: smOklchToRgb,
    hexToRgb: _hexToRgb,
    rgbToHex: _rgbToHex,

    // 核心算法组件（高级用户/调试可用）
    getLTargets: smGetLTargets,
    getChromaRatios: smGetChromaRatios,

    // 常量表
    STEPS: SM_STEPS,
    GRAY_L: SM_GRAY_L,
    FAMILIES: SM_FAMILIES,
    getHueRefCurves: smGetHueRefCurves
  };
}));
