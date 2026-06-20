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
    50: 0.98, 100: 0.97, 200: 0.92, 300: 0.87, 400: 0.71,
    500: 0.55, 600: 0.44, 700: 0.37, 800: 0.27, 900: 0.21, 950: 0.14
  };

  // ===== 彩色系亮度目标表 =====
  // 来源：Tailwind v4 的 17 套彩色色系（Red、Orange、Yellow、Green、Blue、Purple 等）的平均值。
  // 由于 Helmholtz-Kohlrausch 效应，人眼觉得鲜艳颜色更亮，因此彩色系的 L 值整体更高。
  // 例如：同样叫“500 档”的黄色，L=0.80，而灰色只有 L=0.55。
  // 当输入色很鲜艳时，算法会更多使用这张表。
  const SM_CHROMATIC_L = {
    50: 0.98, 100: 0.95, 200: 0.91, 300: 0.84, 400: 0.75,
    500: 0.65, 600: 0.56, 700: 0.48, 800: 0.41, 900: 0.35, 950: 0.25
  };

  // ===== Chroma 比率参考曲线 =====
  // 以 500 档 Chroma 为 1.0，其他档位的 Chroma 相对值。
  // 不同饱和度的颜色，Chroma 峰值位置不同：
  //   - 低饱和度（Low-C）：峰值在 400 档
  //   - 中饱和度（Mid-C）：峰值在 500 档
  //   - 高饱和度（High-C）：峰值在 600 档
  // 这是 Tailwind 手工调校的结果，不是固定的钟形曲线。
  const SM_CR_LOW = {
    50: 0.12, 100: 0.34, 200: 0.62, 300: 0.94, 400: 1.08,
    500: 1.00, 600: 0.86, 700: 0.71, 800: 0.58, 900: 0.47, 950: 0.36
  };
  const SM_CR_MID = {
    50: 0.10, 100: 0.24, 200: 0.46, 300: 0.74, 400: 0.95,
    500: 1.00, 600: 0.96, 700: 0.83, 800: 0.68, 900: 0.54, 950: 0.36
  };
  const SM_CR_HIGH = {
    50: 0.07, 100: 0.15, 200: 0.29, 300: 0.52, 400: 0.82,
    500: 1.00, 600: 1.04, 700: 0.92, 800: 0.77, 900: 0.62, 950: 0.44
  };

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
  function _smGetLTargetsWithAnchor(inputL, inputC, anchorStep) {
    const chromaFactor = Math.min(Math.max(inputC / 0.30, 0), 1);

    const baseL = {};
    SM_STEPS.forEach(function (step) {
      baseL[step] = SM_GRAY_L[step] + chromaFactor * (SM_CHROMATIC_L[step] - SM_GRAY_L[step]);
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

  function smGetLTargets(inputL, inputC) {
    // 两阶段锚点定位：
    //   第一轮：基于原始插值曲线（无锚点校正）找到输入色自然属于哪个档位
    //   第二轮：以该档位为锚点做校正，让整条曲线围绕输入色自然展开
    const chromaFactor = Math.min(Math.max(inputC / 0.30, 0), 1);

    const rawBaseL = {};
    SM_STEPS.forEach(function (step) {
      rawBaseL[step] = SM_GRAY_L[step] + chromaFactor * (SM_CHROMATIC_L[step] - SM_GRAY_L[step]);
    });

    let bestStep = 500;
    let minDiff = Infinity;
    SM_STEPS.forEach(function (step) {
      const diff = Math.abs(inputL - rawBaseL[step]);
      if (diff < minDiff) {
        minDiff = diff;
        bestStep = step;
      }
    });

    return _smGetLTargetsWithAnchor(inputL, inputC, bestStep);
  }

  // ===== 核心算法：自适应 Chroma 比率 =====
  // 输入：当前颜色的 C（饱和度）
  // 输出：11 个档位的 Chroma 相对比率
  //
  // 根据 C 值在 Low-C、Mid-C、High-C 三条参考曲线之间线性插值。
  // 这样低饱和度颜色在 400 档最鲜艳，高饱和度颜色在 600 档最鲜艳，
  // 更符合人眼对真实色阶的期望。
  function smGetChromaRatios(inputC) {
    let ratios;
    if (inputC <= 0.14) {
      ratios = SM_CR_LOW;
    } else if (inputC >= 0.26) {
      ratios = SM_CR_HIGH;
    } else if (inputC <= 0.18) {
      // 在 Low-C 和 Mid-C 之间插值
      const t = (inputC - 0.14) / (0.18 - 0.14);
      ratios = {};
      SM_STEPS.forEach(function (step) {
        ratios[step] = SM_CR_LOW[step] * (1 - t) + SM_CR_MID[step] * t;
      });
    } else {
      // 在 Mid-C 和 High-C 之间插值
      const t = (inputC - 0.18) / (0.26 - 0.18);
      ratios = {};
      SM_STEPS.forEach(function (step) {
        ratios[step] = SM_CR_MID[step] * (1 - t) + SM_CR_HIGH[step] * t;
      });
    }
    return ratios;
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
    //   基于原始曲线找 bestStep → 以 bestStep 为锚点生成 L 目标
    const lTargets = smGetLTargets(l, c);

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

    const chromaRatios = smGetChromaRatios(c);
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
    CHROMATIC_L: SM_CHROMATIC_L,
    CR_LOW: SM_CR_LOW,
    CR_MID: SM_CR_MID,
    CR_HIGH: SM_CR_HIGH
  };
}));
