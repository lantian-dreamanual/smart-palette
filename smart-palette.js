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
  //  Smart Palette v2 — 基于 OKLCH Cubic Spline 曲线拟合的智能色阶生成器
  // ============================================================
  //
  // 核心思路（v2 相比 v1 的根本性升级）：
  //
  // v1（参数化模型）：
  //   色相匹配找最近两个色系 → 灰彩插值 → 锚点校正 → 生成色板
  //   局限：线性插值无法捕捉色系间的非线性变化，尤其在色相间距大时精度不够
  //
  // v2（曲线拟合模型）：
  //   1. 从 Tailwind V4 官方色板提取 17 个非灰阶色系的 OKLCH 数据
  //   2. 对每个色阶 (50-950) 分别建立 hue → (L, C, h) 的样条拟合
  //   3. 横向曲线（跨色系）用 PCHIP 保证单调性，纵向曲线（跨色阶）用 Akima 保证平滑
  //   4. 对 hue 维度使用循环插值处理 0°/360° 环绕
  //   5. 输入任意色相角，直接从拟合曲线上取值，输出 11 色阶的科学配色方案
  //   6. 支持暗端色相修正：深色输入时反推基础色相，使暗端色阶与输入色色相一致
  //
  // 数据来源: Tailwind CSS v4 官方色板
  // ============================================================

  // ===== 档位序列 =====
  var SM_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];


  // ============================================================
  // 1. 原始数据：Tailwind V4 非灰阶色系 OKLCH 值
  // 格式: { 色系名: { 色阶: [L, C, h], ... } }
  // L: Lightness (0-100), C: Chroma, h: Hue angle (0-360)
  // ============================================================

  var TV4_COLORS = {
    Red:     { 50:[97.05,0.0129,17.38], 100:[93.56,0.0309,17.72], 200:[88.45,0.0593,18.33], 300:[80.77,0.1035,19.57], 400:[71.06,0.1661,22.22], 500:[63.68,0.2078,25.33], 600:[57.71,0.2152,27.33], 700:[50.54,0.1905,27.52], 800:[44.37,0.1613,26.9],  900:[39.58,0.1331,25.72], 950:[25.75,0.0886,26.04] },
    Orange:  { 50:[97.96,0.0158,73.68], 100:[95.42,0.0372,75.16], 200:[90.15,0.0729,70.7],  300:[83.66,0.1165,66.29], 400:[75.76,0.1590,55.93], 500:[70.49,0.1867,47.6],  600:[64.61,0.1943,41.12], 700:[55.34,0.1739,38.4],  800:[46.98,0.1430,37.3],  900:[40.84,0.1165,38.17], 950:[26.59,0.0762,36.26] },
    Amber:   { 50:[98.69,0.0214,95.28], 100:[96.19,0.0580,95.62], 200:[92.43,0.1151,95.75], 300:[87.9,0.1534,91.61],  400:[83.69,0.1644,84.43], 500:[76.86,0.1647,70.08],  600:[66.58,0.1574,58.32], 700:[55.53,0.1455,49.0],  800:[47.32,0.1247,46.2],  900:[41.37,0.1054,45.9],  950:[27.91,0.0742,45.64] },
    Yellow:  { 50:[98.73,0.0262,102.21],100:[97.29,0.0693,103.19],200:[94.51,0.1243,101.54],300:[90.52,0.1657,98.11],  400:[86.06,0.1731,91.94], 500:[79.52,0.1617,86.05],  600:[68.06,0.1423,75.83], 700:[55.38,0.1207,66.44], 800:[47.62,0.1034,61.91], 900:[42.1,0.0897,57.71],  950:[28.57,0.0639,53.81] },
    Lime:    { 50:[98.57,0.0310,120.76],100:[96.69,0.0659,122.33],200:[93.82,0.1217,124.32],300:[89.72,0.1786,126.67],400:[84.93,0.2073,128.85],500:[76.81,0.2044,130.85],600:[64.82,0.1754,131.68],700:[53.22,0.1405,131.59],800:[45.28,0.1129,130.93],900:[40.5,0.0956,131.06], 950:[27.41,0.0688,132.11] },
    Green:   { 50:[98.19,0.0181,155.83],100:[96.24,0.0434,156.74],200:[92.5,0.0806,155.99], 300:[87.12,0.1363,154.45],400:[80.03,0.1821,151.71],500:[72.27,0.1920,149.58],600:[62.71,0.1699,149.21],700:[52.73,0.1371,150.07],800:[44.79,0.1083,151.33],900:[39.25,0.0896,152.54],950:[26.64,0.0628,152.93] },
    Emerald: { 50:[97.93,0.0207,166.11],100:[95.05,0.0507,163.05],200:[90.49,0.0895,164.15],300:[84.52,0.1299,164.98],400:[77.29,0.1535,163.22],500:[69.59,0.1491,162.48],600:[59.6,0.1274,163.23], 700:[50.81,0.1049,165.61],800:[43.18,0.0865,166.91],900:[37.8,0.0730,168.94], 950:[26.21,0.0487,172.55] },
    Teal:    { 50:[98.36,0.0142,180.72],100:[95.27,0.0498,180.8], 200:[91.0,0.0927,180.43], 300:[85.49,0.1251,181.07],400:[78.45,0.1325,181.91],500:[70.38,0.1230,182.5], 600:[60.02,0.1038,184.7], 700:[51.09,0.0861,186.39],800:[43.7,0.0705,188.22], 900:[38.61,0.0590,188.42],950:[27.73,0.0447,192.52] },
    Cyan:    { 50:[98.41,0.0189,200.87],100:[95.63,0.0443,203.39],200:[91.67,0.0772,205.04],300:[86.51,0.1153,207.08],400:[79.71,0.1339,211.53],500:[71.48,0.1257,215.22],600:[60.89,0.1109,221.72],700:[51.98,0.0936,223.13],800:[45.0,0.0771,224.28],  900:[39.82,0.0664,227.39],950:[30.18,0.0541,229.7] },
    Sky:     { 50:[97.71,0.0125,236.62],100:[95.14,0.0250,236.82],200:[90.14,0.0555,230.9], 300:[82.76,0.1013,230.32],400:[75.35,0.1390,232.66],500:[68.47,0.1479,237.32],600:[58.76,0.1389,241.97],700:[50.0,0.1193,242.75], 800:[44.34,0.1000,240.79],900:[39.12,0.0845,240.88],950:[29.35,0.0632,243.16] },
    Blue:    { 50:[97.05,0.0142,254.6], 100:[93.19,0.0316,255.59],200:[88.23,0.0571,254.13],300:[80.91,0.0956,251.81],400:[71.37,0.1434,254.62],500:[62.31,0.1880,259.81],600:[54.61,0.2152,262.88],700:[48.82,0.2172,264.38],800:[42.44,0.1809,265.64],900:[37.91,0.1378,265.52],950:[28.23,0.0874,267.94] },
    Indigo:  { 50:[96.19,0.0179,272.31],100:[92.99,0.0334,272.79],200:[86.99,0.0622,274.04],300:[78.53,0.1041,274.71],400:[68.01,0.1583,276.93],500:[58.54,0.2041,277.12],600:[51.06,0.2301,276.97],700:[45.68,0.2146,277.02],800:[39.84,0.1773,277.37],900:[35.88,0.1354,278.7], 950:[25.73,0.0861,281.29] },
    Violet:  { 50:[96.19,0.0179,272.31],100:[94.33,0.0284,294.59],200:[89.43,0.0549,293.28],300:[81.12,0.1013,293.57],400:[70.9,0.1592,293.54], 500:[60.56,0.2189,292.72],600:[54.13,0.2466,293.01],700:[49.07,0.2412,292.58],800:[43.2,0.2106,292.76], 900:[37.96,0.1783,293.74],950:[28.27,0.1351,291.09] },
    Purple:  { 50:[97.68,0.0142,308.3], 100:[94.64,0.0327,307.17],200:[90.24,0.0604,306.7],  300:[82.68,0.1082,306.38],400:[72.17,0.1767,305.5], 500:[62.68,0.2325,303.9], 600:[55.75,0.2525,302.32],700:[49.55,0.2369,301.92],800:[43.83,0.1983,303.72],900:[38.07,0.1661,304.99],950:[29.05,0.1432,302.72] },
    Fuchsia: { 50:[97.73,0.0173,320.06],100:[95.2,0.0360,318.85], 200:[90.3,0.0732,319.62],  300:[83.3,0.1322,321.43], 400:[74.77,0.2070,322.16],500:[66.68,0.2591,322.15],600:[59.15,0.2569,322.9], 700:[51.8,0.2258,323.95], 800:[45.19,0.1922,324.59],900:[40.07,0.1601,325.61],950:[29.32,0.1309,325.66] },
    Pink:    { 50:[97.14,0.0141,343.2], 100:[94.82,0.0276,342.26],200:[89.94,0.0589,343.23],300:[82.28,0.1095,346.02],400:[72.53,0.1752,349.76],500:[65.59,0.2118,354.31],600:[59.16,0.2180,0.58],  700:[52.46,0.1990,3.96],  800:[45.87,0.1697,3.82],  900:[40.78,0.1442,2.43],  950:[28.45,0.1048,3.91] },
    Rose:    { 50:[96.94,0.0151,12.42], 100:[94.14,0.0297,12.58], 200:[89.24,0.0559,10.0],  300:[80.97,0.1061,11.64], 400:[71.92,0.1690,13.43], 500:[64.5,0.2154,16.44],  600:[58.58,0.2220,17.58], 700:[51.43,0.1978,16.93], 800:[45.46,0.1713,13.7],  900:[41.03,0.1502,10.27], 950:[27.08,0.1009,12.09] }
  };


  // ============================================================
  // 2. PCHIP (Piecewise Cubic Hermite Interpolating Polynomial)
  // ============================================================
  // 保证单调性的分段三次 Hermite 插值，用于横向曲线（跨色系 hue→L/C）。
  // 在斜率突变处不会产生 overshoot/undershoot，解决了蓝紫色系 C 值下凹问题。

  function _pchip(xs, ys) {
    var n = xs.length;
    if (n < 2) {
      var y0 = n === 1 ? ys[0] : 0;
      return function(x) { return y0; };
    }
    if (n === 2) {
      var x0 = xs[0], x1 = xs[1], y0v = ys[0], y1v = ys[1];
      return function(x) { return y0v + (y1v - y0v) * (x - x0) / (x1 - x0); };
    }

    // 计算分段斜率
    var h = [], del = [];
    for (var i = 0; i < n - 1; i++) {
      h[i] = xs[i + 1] - xs[i];
      del[i] = (ys[i + 1] - ys[i]) / h[i];
    }

    // Fritsch-Carlson 方法计算 PCHIP 导数
    var d = new Array(n);

    // 端点导数
    d[0] = del[0];
    d[n - 1] = del[n - 2];

    // 内部点导数
    for (var i = 1; i < n - 1; i++) {
      // 如果两侧斜率符号不同或其一为零 → 导数为零（局部极值点）
      if (del[i - 1] * del[i] <= 0) {
        d[i] = 0;
      } else {
        // Harmonic mean of slopes (Fritsch-Carlson)
        var w1 = 2 * h[i] + h[i - 1];
        var w2 = h[i] + 2 * h[i - 1];
        d[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i]);
      }
    }

    // 构建分段三次 Hermite 基函数
    return function(x) {
      // 二分查找区间
      var lo = 0, hi = n - 2;
      if (x <= xs[0]) lo = 0;
      else if (x >= xs[n - 1]) lo = n - 2;
      else {
        while (hi - lo > 1) {
          var mid = (lo + hi) >> 1;
          if (xs[mid] <= x) lo = mid;
          else hi = mid;
        }
      }

      var dx = x - xs[lo];
      var hi_ = h[lo];
      var t = dx / hi_;

      // Hermite 基函数
      var h00 = (1 + 2 * t) * (1 - t) * (1 - t);
      var h10 = t * (1 - t) * (1 - t);
      var h01 = t * t * (3 - 2 * t);
      var h11 = t * t * (t - 1);

      return h00 * ys[lo] + h10 * hi_ * d[lo] + h01 * ys[lo + 1] + h11 * hi_ * d[lo + 1];
    };
  }


  // ============================================================
  // 3. Akima 样条（纵向曲线，跨色阶）
  // ============================================================
  // Akima 样条对异常斜率不敏感，在数据点密集且平滑的区域表现优秀。
  // 用于纵向曲线（同一色系内，step→L/C/h），比自然三次样条更稳定。

  function _akimaSpline(xs, ys) {
    var n = xs.length;
    if (n < 2) {
      var y0 = n === 1 ? ys[0] : 0;
      return function(x) { return y0; };
    }
    if (n === 2) {
      var x0 = xs[0], x1 = xs[1], y0v = ys[0], y1v = ys[1];
      return function(x) { return y0v + (y1v - y0v) * (x - x0) / (x1 - x0); };
    }
    if (n === 3) {
      // 退化为自然三次样条（Akima 需要至少 5 个点才能计算外部斜率）
      return _cubicSplineSimple(xs, ys);
    }

    // 计算分段斜率
    var m = [];
    for (var i = 0; i < n - 1; i++) {
      m[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    }

    // 计算 Akima 导数
    // 需要扩展斜率：m[-2], m[-1], m[n-1], m[n]
    // Akima 方法：用最外部分段斜率直接延伸
    var mExt = [];
    mExt[0] = 3 * m[0] - 2 * m[1];  // m[-2]
    mExt[1] = 2 * m[0] - m[1];      // m[-1]
    for (var i = 0; i < m.length; i++) {
      mExt[i + 2] = m[i];
    }
    mExt[m.length + 2] = 2 * m[m.length - 1] - m[m.length - 2];         // m[n-1]
    mExt[m.length + 3] = 3 * m[m.length - 1] - 2 * m[m.length - 2];     // m[n]

    // 计算每个节点的导数
    var d = new Array(n);
    for (var i = 0; i < n; i++) {
      var idx = i + 2; // 在 mExt 中的索引
      var w1 = Math.abs(mExt[idx + 1] - mExt[idx]);
      var w2 = Math.abs(mExt[idx - 1] - mExt[idx - 2]);
      if (w1 + w2 === 0) {
        d[i] = (mExt[idx - 1] + mExt[idx]) / 2;
      } else {
        d[i] = (w1 * mExt[idx - 1] + w2 * mExt[idx]) / (w1 + w2);
      }
    }

    // 构建分段三次 Hermite 插值
    var hs = [];
    for (var i = 0; i < n - 1; i++) {
      hs[i] = xs[i + 1] - xs[i];
    }

    return function(x) {
      var lo = 0, hiIdx = n - 2;
      if (x <= xs[0]) lo = 0;
      else if (x >= xs[n - 1]) lo = n - 2;
      else {
        while (hiIdx - lo > 1) {
          var mid = (lo + hiIdx) >> 1;
          if (xs[mid] <= x) lo = mid;
          else hiIdx = mid;
        }
      }

      var dx = x - xs[lo];
      var h = hs[lo];
      var t = dx / h;

      var h00 = (1 + 2 * t) * (1 - t) * (1 - t);
      var h10 = t * (1 - t) * (1 - t);
      var h01 = t * t * (3 - 2 * t);
      var h11 = t * t * (t - 1);

      return h00 * ys[lo] + h10 * h * d[lo] + h01 * ys[lo + 1] + h11 * h * d[lo + 1];
    };
  }

  // 简单自然三次样条（当数据点不足以使用 Akima 时的后备）
  function _cubicSplineSimple(xs, ys) {
    var n = xs.length;
    if (n < 2) {
      var y0 = n === 1 ? ys[0] : 0;
      return function(x) { return y0; };
    }
    if (n === 2) {
      var x0 = xs[0], x1 = xs[1], y0v = ys[0], y1v = ys[1];
      return function(x) { return y0v + (y1v - y0v) * (x - x0) / (x1 - x0); };
    }

    var h = [];
    for (var i = 0; i < n - 1; i++) h[i] = xs[i + 1] - xs[i];

    var alpha = [0];
    for (var i = 1; i < n - 1; i++) {
      alpha[i] = 3 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1]);
    }

    var l = [1], mu = [0], z = [0];
    for (var i = 1; i < n - 1; i++) {
      l[i] = 2 * (xs[i + 1] - xs[i - 1]) - h[i - 1] * mu[i - 1];
      mu[i] = h[i] / (l[i] || 1);
      z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / (l[i] || 1);
    }

    var c = new Array(n).fill(0), b = new Array(n).fill(0), dd = new Array(n).fill(0);
    for (var j = n - 2; j >= 0; j--) {
      c[j] = z[j] - mu[j] * c[j + 1];
      b[j] = (ys[j + 1] - ys[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
      dd[j] = (c[j + 1] - c[j]) / (3 * h[j]);
    }

    return function(x) {
      var lo = 0, hiIdx = n - 2;
      if (x <= xs[0]) lo = 0;
      else if (x >= xs[n - 1]) lo = n - 2;
      else {
        while (hiIdx - lo > 1) {
          var mid = (lo + hiIdx) >> 1;
          if (xs[mid] <= x) lo = mid;
          else hiIdx = mid;
        }
      }
      var dx = x - xs[lo];
      return ys[lo] + b[lo] * dx + c[lo] * dx * dx + dd[lo] * dx * dx * dx;
    };
  }


  // ============================================================
  // 4. 循环样条拟合（处理色相环绕）
  // ============================================================

  function _circularSpline(xs, hs) {
    // 对周期性 hue 值进行循环样条拟合
    // 将角度映射到 cos/sin，分别拟合 PCHIP，再 arctan2 回角度
    var cosHs = hs.map(function(h) { return Math.cos(h * Math.PI / 180); });
    var sinHs = hs.map(function(h) { return Math.sin(h * Math.PI / 180); });

    var pchipCos = _pchip(xs, cosHs);
    var pchipSin = _pchip(xs, sinHs);

    return function(x) {
      var c = pchipCos(x);
      var s = pchipSin(x);
      return ((Math.atan2(s, c) * 180 / Math.PI) + 360) % 360;
    };
  }


  // ============================================================
  // 5. 预计算拟合曲线
  // ============================================================

  var _TV4_SPLINE_L = null;
  var _TV4_SPLINE_C = null;
  var _TV4_SPLINE_H = null;

  function _tv4BuildSplines() {
    // 按 500 档 hue 排序色系名
    var sortedNames = Object.keys(TV4_COLORS).sort(function(a, b) {
      return TV4_COLORS[a][500][2] - TV4_COLORS[b][500][2];
    });

    var anchorHues = {};
    sortedNames.forEach(function(name) {
      anchorHues[name] = TV4_COLORS[name][500][2];
    });

    // 扩展数据 ±360° 处理色相环绕
    var extendedData = {};
    var extendedHues = [];

    sortedNames.forEach(function(name) {
      var h = anchorHues[name];
      [-360, 0, 360].forEach(function(offset) {
        var key = h + offset;
        extendedHues.push(key);
        extendedData[key] = TV4_COLORS[name];
      });
    });

    // 去重排序
    extendedHues = extendedHues.filter(function(v, i, a) { return a.indexOf(v) === i; });
    extendedHues.sort(function(a, b) { return a - b; });

    var splineL = {};
    var splineC = {};
    var splineH = {};

    SM_STEPS.forEach(function(step) {
      var hueList = [], LList = [], CList = [], hList = [];

      extendedHues.forEach(function(h) {
        hueList.push(h);
        var data = extendedData[h][step];
        LList.push(data[0]);
        CList.push(data[1]);
        hList.push(data[2]);
      });

      // 按 hue 排序
      var indices = hueList.map(function(v, i) { return i; });
      indices.sort(function(a, b) { return hueList[a] - hueList[b]; });

      var sortedHues = indices.map(function(i) { return hueList[i]; });
      var sortedL = indices.map(function(i) { return LList[i]; });
      var sortedC = indices.map(function(i) { return CList[i]; });
      var sortedH = indices.map(function(i) { return hList[i]; });

      // 横向曲线：PCHIP（保证单调性，消除下凹/overshoot）
      splineL[step] = _pchip(sortedHues, sortedL);
      splineC[step] = _pchip(sortedHues, sortedC);
      // 色相用循环插值
      splineH[step] = _circularSpline(sortedHues, sortedH);
    });

    _TV4_SPLINE_L = splineL;
    _TV4_SPLINE_C = splineC;
    _TV4_SPLINE_H = splineH;
  }

  // 初始化
  _tv4BuildSplines();


  // ============================================================
  // 6. OKLCH 颜色空间转换
  // ============================================================

  function _toLinear(x) {
    return x >= 0.04045 ? Math.pow((x + 0.055) / 1.055, 2.4) : x / 12.92;
  }

  function _fromLinear(x) {
    return x >= 0.0031308 ? 1.055 * Math.pow(x, 1 / 2.4) - 0.055 : 12.92 * x;
  }

  function smRgbToOklch(r, g, b) {
    var lr = _toLinear(r), lg = _toLinear(g), lb = _toLinear(b);

    var lms_ = {
      l: Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb),
      m: Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb),
      s: Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
    };

    var lab = {
      l: 0.2104542553 * lms_.l + 0.7936177850 * lms_.m - 0.0040720468 * lms_.s,
      a: 1.9779984951 * lms_.l - 2.4285922050 * lms_.m + 0.4505937099 * lms_.s,
      b: 0.0259040371 * lms_.l + 0.7827717662 * lms_.m - 0.8086757660 * lms_.s
    };

    var c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    var h = c < 0.0001 ? 0 : (Math.atan2(lab.b, lab.a) * 180 / Math.PI + 360) % 360;

    return { l: lab.l, c: c, h: h };
  }

  function smOklchToRgb(l, c, h) {
    var hRad = h * Math.PI / 180;
    var a = c * Math.cos(hRad);
    var b = c * Math.sin(hRad);

    var lms_ = {
      l: l + 0.3963377774 * a + 0.2158037573 * b,
      m: l - 0.1055613458 * a - 0.0638541728 * b,
      s: l - 0.0894841775 * a - 1.2914855480 * b
    };

    var lms = {
      l: lms_.l * lms_.l * lms_.l,
      m: lms_.m * lms_.m * lms_.m,
      s: lms_.s * lms_.s * lms_.s
    };

    return {
      r: Math.round(_fromLinear(Math.max(0, Math.min(1, 4.0767416621 * lms.l - 3.3077115913 * lms.m + 0.2309699292 * lms.s))) * 255),
      g: Math.round(_fromLinear(Math.max(0, Math.min(1, -1.2684380046 * lms.l + 2.6097574011 * lms.m - 0.3413193965 * lms.s))) * 255),
      b: Math.round(_fromLinear(Math.max(0, Math.min(1, -0.0041960863 * lms.l - 0.7034186147 * lms.m + 1.7076147010 * lms.s))) * 255)
    };
  }

  function _hexToRgb(hex) {
    var hexClean = hex.replace('#', '');
    var hex6 = hexClean.length === 3
      ? hexClean[0] + hexClean[0] + hexClean[1] + hexClean[1] + hexClean[2] + hexClean[2]
      : hexClean;
    return {
      r: parseInt(hex6.substring(0, 2), 16) / 255,
      g: parseInt(hex6.substring(2, 4), 16) / 255,
      b: parseInt(hex6.substring(4, 6), 16) / 255
    };
  }

  function _rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function(x) {
      return Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
    }).join('');
  }


  // ============================================================
  // 7. 色域保护
  // ============================================================

  function smOklchToRgbInGamut(l, c, h) {
    var currentC = Math.max(0, c);
    while (currentC > 0.001) {
      var hRad = h * Math.PI / 180;
      var a = currentC * Math.cos(hRad);
      var b = currentC * Math.sin(hRad);

      var lms_ = {
        l: l + 0.3963377774 * a + 0.2158037573 * b,
        m: l - 0.1055613458 * a - 0.0638541728 * b,
        s: l - 0.0894841775 * a - 1.2914855480 * b
      };

      var lms = {
        l: lms_.l * lms_.l * lms_.l,
        m: lms_.m * lms_.m * lms_.m,
        s: lms_.s * lms_.s * lms_.s
      };

      var lr = 4.0767416621 * lms.l - 3.3077115913 * lms.m + 0.2309699292 * lms.s;
      var lg = -1.2684380046 * lms.l + 2.6097574011 * lms.m - 0.3413193965 * lms.s;
      var lb = -0.0041960863 * lms.l - 0.7034186147 * lms.m + 1.7076147010 * lms.s;

      if (lr >= -0.001 && lr <= 1.001 && lg >= -0.001 && lg <= 1.001 && lb >= -0.001 && lb <= 1.001) {
        var r = Math.round(Math.max(0, Math.min(255, _fromLinear(Math.max(0, Math.min(1, lr))) * 255)));
        var g = Math.round(Math.max(0, Math.min(255, _fromLinear(Math.max(0, Math.min(1, lg))) * 255)));
        var bv = Math.round(Math.max(0, Math.min(255, _fromLinear(Math.max(0, Math.min(1, lb))) * 255)));
        return _rgbToHex(r, g, bv);
      }

      currentC *= 0.92;
    }

    var rgb = smOklchToRgb(Math.max(0.01, Math.min(0.99, l)), 0, h);
    return _rgbToHex(rgb.r, rgb.g, rgb.b);
  }


  // ============================================================
  // 8. 核心 API
  // ============================================================

  /**
   * 输入任意色相角 (0-360°)，生成 11 色阶的 OKLCH 色板
   * @param {number} hue - 色相角，范围 0-360
   * @returns {Object} - { 50: [L, C, h], 100: [L, C, h], ..., 950: [L, C, h] }
   *          L: Lightness (0-100), C: Chroma (>=0), h: Hue angle (0-360)
   */
  function tv4GenerateScale(hue) {
    hue = ((hue % 360) + 360) % 360;
    var result = {};

    SM_STEPS.forEach(function(step) {
      var L = _TV4_SPLINE_L[step](hue);
      var C = _TV4_SPLINE_C[step](hue);
      var h = _TV4_SPLINE_H[step](hue);

      L = Math.max(0, Math.min(100, L));
      C = Math.max(0, C);
      h = ((h % 360) + 360) % 360;

      result[step] = [
        Math.round(L * 100) / 100,
        Math.round(C * 10000) / 10000,
        Math.round(h * 100) / 100
      ];
    });

    return result;
  }


  /**
   * 从输入颜色反推其最可能对应的 500 档色相（暗端色相修正用）
   * 在暗端色阶 (500-950) 的样条曲线上搜索，
   * 找到哪个 500 档锚点 hue 会产生最接近输入色的暗端 hue。
   * @param {number} inputL - OKLCH Lightness (0-100)
   * @param {number} inputC - OKLCH Chroma
   * @param {number} inputH - OKLCH Hue (0-360)
   * @returns {Object} - { anchorHue, bestStep, error }
   */
  function tv4EstimateAnchorHue(inputL, inputC, inputH) {
    var bestStep = null;
    var bestHueAnchor = 0;
    var minError = Infinity;

    var searchSteps = [500, 600, 700, 800, 900, 950];

    // 0.5° 精度搜索
    for (var si = 0; si < searchSteps.length; si++) {
      var step = searchSteps[si];
      for (var testHue = 0; testHue < 360; testHue += 0.5) {
        var predH = _TV4_SPLINE_H[step](testHue);
        var diff = Math.abs(predH - inputH);
        if (diff > 180) diff = 360 - diff;

        var predL = _TV4_SPLINE_L[step](testHue);
        var lDiff = Math.abs(predL - inputL);

        var combinedError = diff + lDiff * 0.5;
        if (combinedError < minError) {
          minError = combinedError;
          bestStep = step;
          bestHueAnchor = testHue;
        }
      }
    }

    return {
      anchorHue: Math.round(bestHueAnchor * 100) / 100,
      bestStep: bestStep,
      error: Math.round(minError * 100) / 100
    };
  }


  /**
   * 智能色阶生成 — 根据开关状态选择策略
   * @param {string} hex - 输入颜色 (#RRGGBB)
   * @param {boolean} hueCorrection - 是否开启暗端色相修正（默认 false）
   * @returns {Object} - { bestStep, originalL, originalC, originalH, usedHue, hueCorrected, isDark, palette }
   *          palette: { 50: '#hex', 100: '#hex', ..., 950: '#hex' }
   */
  function tv4SmartMap(hex, hueCorrection) {
    // HEX -> OKLCH
    var rgb = _hexToRgb(hex);
    var oklch = smRgbToOklch(rgb.r, rgb.g, rgb.b);
    var inputL = oklch.l * 100;   // 转为 0-100 范围
    var inputC = oklch.c;
    var inputH = oklch.h;

    // 判断是否为深色 (L < 60 视为深色)
    var isDark = inputL < 60;

    // 选择策略
    var usedHue = inputH;
    var hueCorrected = false;

    if (hueCorrection && isDark) {
      // 开关开 + 深色 → 反推基础色相
      var est = tv4EstimateAnchorHue(inputL, inputC, inputH);
      usedHue = est.anchorHue;
      hueCorrected = true;
    }

    // 生成色阶
    var scale = tv4GenerateScale(usedHue);

    // 找到最匹配的色阶档位
    var bestStep = 500, minDiff = Infinity;
    SM_STEPS.forEach(function(step) {
      var diff = Math.abs(inputL - scale[step][0]);
      if (diff < minDiff) {
        minDiff = diff;
        bestStep = step;
      }
    });

    // 转换为 HEX（使用色域保护）
    var palette = {};
    SM_STEPS.forEach(function(step) {
      var L = scale[step][0];
      var C = scale[step][1];
      var h = scale[step][2];
      palette[step] = smOklchToRgbInGamut(L / 100, C, h);
    });

    return {
      bestStep: bestStep,
      originalL: oklch.l,
      originalC: inputC,
      originalH: inputH,
      usedHue: usedHue,
      hueCorrected: hueCorrected,
      isDark: isDark,
      palette: palette
    };
  }


  // ============================================================
  // 9. 兼容旧版 API 的适配层
  // ============================================================

  /**
   * 旧版 API 入口：smartMap(hex)
   * 内部调用 tv4SmartMap，暗端色相修正默认关闭
   */
  function smSmartMap(hex) {
    var result = tv4SmartMap(hex, false);
    var bestStep = result.bestStep;

    // 旧版 API 字段兼容
    return {
      bestStep: bestStep,
      isExact: false,
      originalL: result.originalL,
      originalC: result.originalC,
      originalH: result.originalH,
      adjustedL: result.originalL,
      adjustedHex: hex.toUpperCase(),
      originalHex: hex.toUpperCase(),
      palette: result.palette,
      // v2 新增字段
      usedHue: result.usedHue,
      hueCorrected: result.hueCorrected,
      isDark: result.isDark
    };
  }


  // ===== 对外暴露的 API =====
  return {
    // v2 核心入口：输入 HEX + 色相修正开关，返回完整分析结果 + 色板
    smartMap: smSmartMap,

    // v2 新 API：完整参数控制
    tv4SmartMap: tv4SmartMap,

    // 色阶生成（输入色相角，返回 OKLCH 参数）
    generateScale: tv4GenerateScale,

    // 暗端色相修正
    estimateAnchorHue: tv4EstimateAnchorHue,

    // 颜色空间转换工具
    rgbToOklch: smRgbToOklch,
    oklchToRgb: smOklchToRgb,
    oklchToRgbInGamut: smOklchToRgbInGamut,
    hexToRgb: _hexToRgb,
    rgbToHex: _rgbToHex,

    // 常量表
    STEPS: SM_STEPS,
    TV4_COLORS: TV4_COLORS
  };
}));
