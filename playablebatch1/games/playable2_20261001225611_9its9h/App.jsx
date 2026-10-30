(() => {
  if (new URLSearchParams(location.search).get("feedReview") !== "1") return;
  let active = false, alive = true;
  const waiting = /* @__PURE__ */ new Set(), contexts = /* @__PURE__ */ new Set(), media = /* @__PURE__ */ new Set(), streams = /* @__PURE__ */ new Set();
  const wait = () => alive ? new Promise((resolve, reject) => waiting.add({ resolve, reject })) : Promise.reject(new DOMException("Feed closed", "AbortError"));
  if (navigator.mediaDevices?.getUserMedia) {
    const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!active) await wait();
      if (!alive) throw new DOMException("Feed closed", "AbortError");
      const stream = await native(constraints);
      if (!alive || !active) {
        stream.getTracks().forEach((track) => track.stop());
        throw new DOMException("Feed inactive", "AbortError");
      }
      streams.add(stream);
      return stream;
    };
  }
  for (const key of ["AudioContext", "webkitAudioContext"]) {
    const Native = window[key];
    if (!Native) continue;
    window[key] = class FeedAudioContext extends Native {
      constructor(...args) {
        super(...args);
        contexts.add(this);
        if (!active) super.suspend().catch(() => {
        });
      }
      async resume() {
        if (!active) await wait();
        if (alive) return super.resume();
      }
    };
  }
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = async function(...args) {
    media.add(this);
    if (!active) await wait();
    if (alive) return nativePlay.apply(this, args);
  };
  addEventListener("message", (event) => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.type !== "playable-active") return;
    active = alive && event.data.active === true;
    if (active) {
      for (const job of waiting) job.resolve();
      waiting.clear();
      for (const context of contexts) if (context.state !== "closed") context.resume().catch(() => {
      });
    } else {
      for (const context of contexts) if (context.state !== "closed") context.suspend().catch(() => {
      });
      for (const item of media) item.pause();
      for (const stream of streams) stream.getTracks().forEach((track) => track.stop());
      streams.clear();
    }
  });
  addEventListener("pagehide", () => {
    alive = false;
    active = false;
    for (const job of waiting) job.reject(new DOMException("Feed closed", "AbortError"));
    waiting.clear();
    for (const context of contexts) if (context.state !== "closed") context.close().catch(() => {
    });
    for (const item of media) item.pause();
    for (const stream of streams) stream.getTracks().forEach((track) => track.stop());
  }, { once: true });
})();
if (location.protocol === "file:") {
  const config = document.getElementById("playable-config-inline").textContent;
  const originalFetch = window.fetch.bind(window);
  window.fetch = function(input, options) {
    const url = typeof input === "string" ? input : input && input.url;
    if (url && /(?:^|\/)game\.config\.json(?:[?#]|$)/.test(url)) {
      return Promise.resolve(new Response(config, {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    }
    return originalFetch(input, options);
  };
}
(() => {
  var Iv = Object.create;
  var _p = Object.defineProperty;
  var Pv = Object.getOwnPropertyDescriptor;
  var Vv = Object.getOwnPropertyNames;
  var Lv = Object.getPrototypeOf, qv = Object.prototype.hasOwnProperty;
  var Ue = (t, e) => () => (e || t((e = { exports: {} }).exports, e), e.exports);
  var jv = (t, e, r, n) => {
    if (e && typeof e == "object" || typeof e == "function") for (let o of Vv(e)) !qv.call(t, o) && o !== r && _p(t, o, { get: () => e[o], enumerable: !(n = Pv(e, o)) || n.enumerable });
    return t;
  };
  var Gi = (t, e, r) => (r = t != null ? Iv(Lv(t)) : {}, jv(e || !t || !t.__esModule ? _p(r, "default", { value: t, enumerable: true }) : r, t));
  var Ep = Ue((re) => {
    "use strict";
    var Cs = Symbol.for("react.element"), zv = Symbol.for("react.portal"), Wv = Symbol.for("react.fragment"), Bv = Symbol.for("react.strict_mode"), Uv = Symbol.for("react.profiler"), Gv = Symbol.for("react.provider"), Qv = Symbol.for("react.context"), Hv = Symbol.for("react.forward_ref"), $v = Symbol.for("react.suspense"), Yv = Symbol.for("react.memo"), Xv = Symbol.for("react.lazy"), xp = Symbol.iterator;
    function Zv(t) {
      return t === null || typeof t != "object" ? null : (t = xp && t[xp] || t["@@iterator"], typeof t == "function" ? t : null);
    }
    var wp = { isMounted: function() {
      return false;
    }, enqueueForceUpdate: function() {
    }, enqueueReplaceState: function() {
    }, enqueueSetState: function() {
    } }, Sp = Object.assign, Tp = {};
    function fo(t, e, r) {
      this.props = t, this.context = e, this.refs = Tp, this.updater = r || wp;
    }
    fo.prototype.isReactComponent = {};
    fo.prototype.setState = function(t, e) {
      if (typeof t != "object" && typeof t != "function" && t != null) throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");
      this.updater.enqueueSetState(this, t, e, "setState");
    };
    fo.prototype.forceUpdate = function(t) {
      this.updater.enqueueForceUpdate(this, t, "forceUpdate");
    };
    function Ap() {
    }
    Ap.prototype = fo.prototype;
    function ou(t, e, r) {
      this.props = t, this.context = e, this.refs = Tp, this.updater = r || wp;
    }
    var su = ou.prototype = new Ap();
    su.constructor = ou;
    Sp(su, fo.prototype);
    su.isPureReactComponent = true;
    var yp = Array.isArray, kp = Object.prototype.hasOwnProperty, iu = { current: null }, Cp = { key: true, ref: true, __self: true, __source: true };
    function Np(t, e, r) {
      var n, o = {}, s = null, i = null;
      if (e != null) for (n in e.ref !== void 0 && (i = e.ref), e.key !== void 0 && (s = "" + e.key), e) kp.call(e, n) && !Cp.hasOwnProperty(n) && (o[n] = e[n]);
      var a = arguments.length - 2;
      if (a === 1) o.children = r;
      else if (1 < a) {
        for (var l = Array(a), u = 0; u < a; u++) l[u] = arguments[u + 2];
        o.children = l;
      }
      if (t && t.defaultProps) for (n in a = t.defaultProps, a) o[n] === void 0 && (o[n] = a[n]);
      return { $$typeof: Cs, type: t, key: s, ref: i, props: o, _owner: iu.current };
    }
    function Kv(t, e) {
      return { $$typeof: Cs, type: t.type, key: e, ref: t.ref, props: t.props, _owner: t._owner };
    }
    function au(t) {
      return typeof t == "object" && t !== null && t.$$typeof === Cs;
    }
    function Jv(t) {
      var e = { "=": "=0", ":": "=2" };
      return "$" + t.replace(/[=:]/g, function(r) {
        return e[r];
      });
    }
    var vp = /\/+/g;
    function nu(t, e) {
      return typeof t == "object" && t !== null && t.key != null ? Jv("" + t.key) : e.toString(36);
    }
    function Hi(t, e, r, n, o) {
      var s = typeof t;
      (s === "undefined" || s === "boolean") && (t = null);
      var i = false;
      if (t === null) i = true;
      else switch (s) {
        case "string":
        case "number":
          i = true;
          break;
        case "object":
          switch (t.$$typeof) {
            case Cs:
            case zv:
              i = true;
          }
      }
      if (i) return i = t, o = o(i), t = n === "" ? "." + nu(i, 0) : n, yp(o) ? (r = "", t != null && (r = t.replace(vp, "$&/") + "/"), Hi(o, e, r, "", function(u) {
        return u;
      })) : o != null && (au(o) && (o = Kv(o, r + (!o.key || i && i.key === o.key ? "" : ("" + o.key).replace(vp, "$&/") + "/") + t)), e.push(o)), 1;
      if (i = 0, n = n === "" ? "." : n + ":", yp(t)) for (var a = 0; a < t.length; a++) {
        s = t[a];
        var l = n + nu(s, a);
        i += Hi(s, e, r, l, o);
      }
      else if (l = Zv(t), typeof l == "function") for (t = l.call(t), a = 0; !(s = t.next()).done; ) s = s.value, l = n + nu(s, a++), i += Hi(s, e, r, l, o);
      else if (s === "object") throw e = String(t), Error("Objects are not valid as a React child (found: " + (e === "[object Object]" ? "object with keys {" + Object.keys(t).join(", ") + "}" : e) + "). If you meant to render a collection of children, use an array instead.");
      return i;
    }
    function Qi(t, e, r) {
      if (t == null) return t;
      var n = [], o = 0;
      return Hi(t, n, "", "", function(s) {
        return e.call(r, s, o++);
      }), n;
    }
    function e0(t) {
      if (t._status === -1) {
        var e = t._result;
        e = e(), e.then(function(r) {
          (t._status === 0 || t._status === -1) && (t._status = 1, t._result = r);
        }, function(r) {
          (t._status === 0 || t._status === -1) && (t._status = 2, t._result = r);
        }), t._status === -1 && (t._status = 0, t._result = e);
      }
      if (t._status === 1) return t._result.default;
      throw t._result;
    }
    var ft = { current: null }, $i = { transition: null }, t0 = { ReactCurrentDispatcher: ft, ReactCurrentBatchConfig: $i, ReactCurrentOwner: iu };
    function Op() {
      throw Error("act(...) is not supported in production builds of React.");
    }
    re.Children = { map: Qi, forEach: function(t, e, r) {
      Qi(t, function() {
        e.apply(this, arguments);
      }, r);
    }, count: function(t) {
      var e = 0;
      return Qi(t, function() {
        e++;
      }), e;
    }, toArray: function(t) {
      return Qi(t, function(e) {
        return e;
      }) || [];
    }, only: function(t) {
      if (!au(t)) throw Error("React.Children.only expected to receive a single React element child.");
      return t;
    } };
    re.Component = fo;
    re.Fragment = Wv;
    re.Profiler = Uv;
    re.PureComponent = ou;
    re.StrictMode = Bv;
    re.Suspense = $v;
    re.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = t0;
    re.act = Op;
    re.cloneElement = function(t, e, r) {
      if (t == null) throw Error("React.cloneElement(...): The argument must be a React element, but you passed " + t + ".");
      var n = Sp({}, t.props), o = t.key, s = t.ref, i = t._owner;
      if (e != null) {
        if (e.ref !== void 0 && (s = e.ref, i = iu.current), e.key !== void 0 && (o = "" + e.key), t.type && t.type.defaultProps) var a = t.type.defaultProps;
        for (l in e) kp.call(e, l) && !Cp.hasOwnProperty(l) && (n[l] = e[l] === void 0 && a !== void 0 ? a[l] : e[l]);
      }
      var l = arguments.length - 2;
      if (l === 1) n.children = r;
      else if (1 < l) {
        a = Array(l);
        for (var u = 0; u < l; u++) a[u] = arguments[u + 2];
        n.children = a;
      }
      return { $$typeof: Cs, type: t.type, key: o, ref: s, props: n, _owner: i };
    };
    re.createContext = function(t) {
      return t = { $$typeof: Qv, _currentValue: t, _currentValue2: t, _threadCount: 0, Provider: null, Consumer: null, _defaultValue: null, _globalName: null }, t.Provider = { $$typeof: Gv, _context: t }, t.Consumer = t;
    };
    re.createElement = Np;
    re.createFactory = function(t) {
      var e = Np.bind(null, t);
      return e.type = t, e;
    };
    re.createRef = function() {
      return { current: null };
    };
    re.forwardRef = function(t) {
      return { $$typeof: Hv, render: t };
    };
    re.isValidElement = au;
    re.lazy = function(t) {
      return { $$typeof: Xv, _payload: { _status: -1, _result: t }, _init: e0 };
    };
    re.memo = function(t, e) {
      return { $$typeof: Yv, type: t, compare: e === void 0 ? null : e };
    };
    re.startTransition = function(t) {
      var e = $i.transition;
      $i.transition = {};
      try {
        t();
      } finally {
        $i.transition = e;
      }
    };
    re.unstable_act = Op;
    re.useCallback = function(t, e) {
      return ft.current.useCallback(t, e);
    };
    re.useContext = function(t) {
      return ft.current.useContext(t);
    };
    re.useDebugValue = function() {
    };
    re.useDeferredValue = function(t) {
      return ft.current.useDeferredValue(t);
    };
    re.useEffect = function(t, e) {
      return ft.current.useEffect(t, e);
    };
    re.useId = function() {
      return ft.current.useId();
    };
    re.useImperativeHandle = function(t, e, r) {
      return ft.current.useImperativeHandle(t, e, r);
    };
    re.useInsertionEffect = function(t, e) {
      return ft.current.useInsertionEffect(t, e);
    };
    re.useLayoutEffect = function(t, e) {
      return ft.current.useLayoutEffect(t, e);
    };
    re.useMemo = function(t, e) {
      return ft.current.useMemo(t, e);
    };
    re.useReducer = function(t, e, r) {
      return ft.current.useReducer(t, e, r);
    };
    re.useRef = function(t) {
      return ft.current.useRef(t);
    };
    re.useState = function(t) {
      return ft.current.useState(t);
    };
    re.useSyncExternalStore = function(t, e, r) {
      return ft.current.useSyncExternalStore(t, e, r);
    };
    re.useTransition = function() {
      return ft.current.useTransition();
    };
    re.version = "18.3.1";
  });
  var lu = Ue((PT, bp) => {
    "use strict";
    bp.exports = Ep();
  });
  var jp = Ue((_e) => {
    "use strict";
    function pu(t, e) {
      var r = t.length;
      t.push(e);
      e: for (; 0 < r; ) {
        var n = r - 1 >>> 1, o = t[n];
        if (0 < Yi(o, e)) t[n] = e, t[r] = o, r = n;
        else break e;
      }
    }
    function sr(t) {
      return t.length === 0 ? null : t[0];
    }
    function Zi(t) {
      if (t.length === 0) return null;
      var e = t[0], r = t.pop();
      if (r !== e) {
        t[0] = r;
        e: for (var n = 0, o = t.length, s = o >>> 1; n < s; ) {
          var i = 2 * (n + 1) - 1, a = t[i], l = i + 1, u = t[l];
          if (0 > Yi(a, r)) l < o && 0 > Yi(u, a) ? (t[n] = u, t[l] = r, n = l) : (t[n] = a, t[i] = r, n = i);
          else if (l < o && 0 > Yi(u, r)) t[n] = u, t[l] = r, n = l;
          else break e;
        }
      }
      return e;
    }
    function Yi(t, e) {
      var r = t.sortIndex - e.sortIndex;
      return r !== 0 ? r : t.id - e.id;
    }
    typeof performance == "object" && typeof performance.now == "function" ? (Dp = performance, _e.unstable_now = function() {
      return Dp.now();
    }) : (uu = Date, Mp = uu.now(), _e.unstable_now = function() {
      return uu.now() - Mp;
    });
    var Dp, uu, Mp, Tr = [], an = [], r0 = 1, Qt = null, st = 3, Ki = false, Ln = false, Os = false, Ip = typeof setTimeout == "function" ? setTimeout : null, Pp = typeof clearTimeout == "function" ? clearTimeout : null, Rp = typeof setImmediate < "u" ? setImmediate : null;
    typeof navigator < "u" && navigator.scheduling !== void 0 && navigator.scheduling.isInputPending !== void 0 && navigator.scheduling.isInputPending.bind(navigator.scheduling);
    function fu(t) {
      for (var e = sr(an); e !== null; ) {
        if (e.callback === null) Zi(an);
        else if (e.startTime <= t) Zi(an), e.sortIndex = e.expirationTime, pu(Tr, e);
        else break;
        e = sr(an);
      }
    }
    function du(t) {
      if (Os = false, fu(t), !Ln) if (sr(Tr) !== null) Ln = true, gu(mu);
      else {
        var e = sr(an);
        e !== null && _u(du, e.startTime - t);
      }
    }
    function mu(t, e) {
      Ln = false, Os && (Os = false, Pp(Es), Es = -1), Ki = true;
      var r = st;
      try {
        for (fu(e), Qt = sr(Tr); Qt !== null && (!(Qt.expirationTime > e) || t && !qp()); ) {
          var n = Qt.callback;
          if (typeof n == "function") {
            Qt.callback = null, st = Qt.priorityLevel;
            var o = n(Qt.expirationTime <= e);
            e = _e.unstable_now(), typeof o == "function" ? Qt.callback = o : Qt === sr(Tr) && Zi(Tr), fu(e);
          } else Zi(Tr);
          Qt = sr(Tr);
        }
        if (Qt !== null) var s = true;
        else {
          var i = sr(an);
          i !== null && _u(du, i.startTime - e), s = false;
        }
        return s;
      } finally {
        Qt = null, st = r, Ki = false;
      }
    }
    var Ji = false, Xi = null, Es = -1, Vp = 5, Lp = -1;
    function qp() {
      return !(_e.unstable_now() - Lp < Vp);
    }
    function cu() {
      if (Xi !== null) {
        var t = _e.unstable_now();
        Lp = t;
        var e = true;
        try {
          e = Xi(true, t);
        } finally {
          e ? Ns() : (Ji = false, Xi = null);
        }
      } else Ji = false;
    }
    var Ns;
    typeof Rp == "function" ? Ns = function() {
      Rp(cu);
    } : typeof MessageChannel < "u" ? (hu = new MessageChannel(), Fp = hu.port2, hu.port1.onmessage = cu, Ns = function() {
      Fp.postMessage(null);
    }) : Ns = function() {
      Ip(cu, 0);
    };
    var hu, Fp;
    function gu(t) {
      Xi = t, Ji || (Ji = true, Ns());
    }
    function _u(t, e) {
      Es = Ip(function() {
        t(_e.unstable_now());
      }, e);
    }
    _e.unstable_IdlePriority = 5;
    _e.unstable_ImmediatePriority = 1;
    _e.unstable_LowPriority = 4;
    _e.unstable_NormalPriority = 3;
    _e.unstable_Profiling = null;
    _e.unstable_UserBlockingPriority = 2;
    _e.unstable_cancelCallback = function(t) {
      t.callback = null;
    };
    _e.unstable_continueExecution = function() {
      Ln || Ki || (Ln = true, gu(mu));
    };
    _e.unstable_forceFrameRate = function(t) {
      0 > t || 125 < t ? console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported") : Vp = 0 < t ? Math.floor(1e3 / t) : 5;
    };
    _e.unstable_getCurrentPriorityLevel = function() {
      return st;
    };
    _e.unstable_getFirstCallbackNode = function() {
      return sr(Tr);
    };
    _e.unstable_next = function(t) {
      switch (st) {
        case 1:
        case 2:
        case 3:
          var e = 3;
          break;
        default:
          e = st;
      }
      var r = st;
      st = e;
      try {
        return t();
      } finally {
        st = r;
      }
    };
    _e.unstable_pauseExecution = function() {
    };
    _e.unstable_requestPaint = function() {
    };
    _e.unstable_runWithPriority = function(t, e) {
      switch (t) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
          break;
        default:
          t = 3;
      }
      var r = st;
      st = t;
      try {
        return e();
      } finally {
        st = r;
      }
    };
    _e.unstable_scheduleCallback = function(t, e, r) {
      var n = _e.unstable_now();
      switch (typeof r == "object" && r !== null ? (r = r.delay, r = typeof r == "number" && 0 < r ? n + r : n) : r = n, t) {
        case 1:
          var o = -1;
          break;
        case 2:
          o = 250;
          break;
        case 5:
          o = 1073741823;
          break;
        case 4:
          o = 1e4;
          break;
        default:
          o = 5e3;
      }
      return o = r + o, t = { id: r0++, callback: e, priorityLevel: t, startTime: r, expirationTime: o, sortIndex: -1 }, r > n ? (t.sortIndex = r, pu(an, t), sr(Tr) === null && t === sr(an) && (Os ? (Pp(Es), Es = -1) : Os = true, _u(du, r - n))) : (t.sortIndex = o, pu(Tr, t), Ln || Ki || (Ln = true, gu(mu))), t;
    };
    _e.unstable_shouldYield = qp;
    _e.unstable_wrapCallback = function(t) {
      var e = st;
      return function() {
        var r = st;
        st = e;
        try {
          return t.apply(this, arguments);
        } finally {
          st = r;
        }
      };
    };
  });
  var Wp = Ue((LT, zp) => {
    "use strict";
    zp.exports = jp();
  });
  var Hm = Ue((Lt) => {
    "use strict";
    var n0 = lu(), Pt = Wp();
    function P(t) {
      for (var e = "https://reactjs.org/docs/error-decoder.html?invariant=" + t, r = 1; r < arguments.length; r++) e += "&args[]=" + encodeURIComponent(arguments[r]);
      return "Minified React error #" + t + "; visit " + e + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
    }
    var Xf = /* @__PURE__ */ new Set(), Zs = {};
    function Zn(t, e) {
      Io(t, e), Io(t + "Capture", e);
    }
    function Io(t, e) {
      for (Zs[t] = e, t = 0; t < e.length; t++) Xf.add(e[t]);
    }
    var Ur = !(typeof window > "u" || typeof window.document > "u" || typeof window.document.createElement > "u"), ju = Object.prototype.hasOwnProperty, o0 = /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/, Bp = {}, Up = {};
    function s0(t) {
      return ju.call(Up, t) ? true : ju.call(Bp, t) ? false : o0.test(t) ? Up[t] = true : (Bp[t] = true, false);
    }
    function i0(t, e, r, n) {
      if (r !== null && r.type === 0) return false;
      switch (typeof e) {
        case "function":
        case "symbol":
          return true;
        case "boolean":
          return n ? false : r !== null ? !r.acceptsBooleans : (t = t.toLowerCase().slice(0, 5), t !== "data-" && t !== "aria-");
        default:
          return false;
      }
    }
    function a0(t, e, r, n) {
      if (e === null || typeof e > "u" || i0(t, e, r, n)) return true;
      if (n) return false;
      if (r !== null) switch (r.type) {
        case 3:
          return !e;
        case 4:
          return e === false;
        case 5:
          return isNaN(e);
        case 6:
          return isNaN(e) || 1 > e;
      }
      return false;
    }
    function gt(t, e, r, n, o, s, i) {
      this.acceptsBooleans = e === 2 || e === 3 || e === 4, this.attributeName = n, this.attributeNamespace = o, this.mustUseProperty = r, this.propertyName = t, this.type = e, this.sanitizeURL = s, this.removeEmptyString = i;
    }
    var tt = {};
    "children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(t) {
      tt[t] = new gt(t, 0, false, t, null, false, false);
    });
    [["acceptCharset", "accept-charset"], ["className", "class"], ["htmlFor", "for"], ["httpEquiv", "http-equiv"]].forEach(function(t) {
      var e = t[0];
      tt[e] = new gt(e, 1, false, t[1], null, false, false);
    });
    ["contentEditable", "draggable", "spellCheck", "value"].forEach(function(t) {
      tt[t] = new gt(t, 2, false, t.toLowerCase(), null, false, false);
    });
    ["autoReverse", "externalResourcesRequired", "focusable", "preserveAlpha"].forEach(function(t) {
      tt[t] = new gt(t, 2, false, t, null, false, false);
    });
    "allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(t) {
      tt[t] = new gt(t, 3, false, t.toLowerCase(), null, false, false);
    });
    ["checked", "multiple", "muted", "selected"].forEach(function(t) {
      tt[t] = new gt(t, 3, true, t, null, false, false);
    });
    ["capture", "download"].forEach(function(t) {
      tt[t] = new gt(t, 4, false, t, null, false, false);
    });
    ["cols", "rows", "size", "span"].forEach(function(t) {
      tt[t] = new gt(t, 6, false, t, null, false, false);
    });
    ["rowSpan", "start"].forEach(function(t) {
      tt[t] = new gt(t, 5, false, t.toLowerCase(), null, false, false);
    });
    var Mc = /[\-:]([a-z])/g;
    function Rc(t) {
      return t[1].toUpperCase();
    }
    "accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(t) {
      var e = t.replace(Mc, Rc);
      tt[e] = new gt(e, 1, false, t, null, false, false);
    });
    "xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(t) {
      var e = t.replace(Mc, Rc);
      tt[e] = new gt(e, 1, false, t, "http://www.w3.org/1999/xlink", false, false);
    });
    ["xml:base", "xml:lang", "xml:space"].forEach(function(t) {
      var e = t.replace(Mc, Rc);
      tt[e] = new gt(e, 1, false, t, "http://www.w3.org/XML/1998/namespace", false, false);
    });
    ["tabIndex", "crossOrigin"].forEach(function(t) {
      tt[t] = new gt(t, 1, false, t.toLowerCase(), null, false, false);
    });
    tt.xlinkHref = new gt("xlinkHref", 1, false, "xlink:href", "http://www.w3.org/1999/xlink", true, false);
    ["src", "href", "action", "formAction"].forEach(function(t) {
      tt[t] = new gt(t, 1, false, t.toLowerCase(), null, true, true);
    });
    function Fc(t, e, r, n) {
      var o = tt.hasOwnProperty(e) ? tt[e] : null;
      (o !== null ? o.type !== 0 : n || !(2 < e.length) || e[0] !== "o" && e[0] !== "O" || e[1] !== "n" && e[1] !== "N") && (a0(e, r, o, n) && (r = null), n || o === null ? s0(e) && (r === null ? t.removeAttribute(e) : t.setAttribute(e, "" + r)) : o.mustUseProperty ? t[o.propertyName] = r === null ? o.type === 3 ? false : "" : r : (e = o.attributeName, n = o.attributeNamespace, r === null ? t.removeAttribute(e) : (o = o.type, r = o === 3 || o === 4 && r === true ? "" : "" + r, n ? t.setAttributeNS(n, e, r) : t.setAttribute(e, r))));
    }
    var $r = n0.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, ea = Symbol.for("react.element"), _o = Symbol.for("react.portal"), xo = Symbol.for("react.fragment"), Ic = Symbol.for("react.strict_mode"), zu = Symbol.for("react.profiler"), Zf = Symbol.for("react.provider"), Kf = Symbol.for("react.context"), Pc = Symbol.for("react.forward_ref"), Wu = Symbol.for("react.suspense"), Bu = Symbol.for("react.suspense_list"), Vc = Symbol.for("react.memo"), un = Symbol.for("react.lazy");
    Symbol.for("react.scope");
    Symbol.for("react.debug_trace_mode");
    var Jf = Symbol.for("react.offscreen");
    Symbol.for("react.legacy_hidden");
    Symbol.for("react.cache");
    Symbol.for("react.tracing_marker");
    var Gp = Symbol.iterator;
    function bs(t) {
      return t === null || typeof t != "object" ? null : (t = Gp && t[Gp] || t["@@iterator"], typeof t == "function" ? t : null);
    }
    var Ne = Object.assign, xu;
    function Ls(t) {
      if (xu === void 0) try {
        throw Error();
      } catch (r) {
        var e = r.stack.trim().match(/\n( *(at )?)/);
        xu = e && e[1] || "";
      }
      return `
` + xu + t;
    }
    var yu = false;
    function vu(t, e) {
      if (!t || yu) return "";
      yu = true;
      var r = Error.prepareStackTrace;
      Error.prepareStackTrace = void 0;
      try {
        if (e) if (e = function() {
          throw Error();
        }, Object.defineProperty(e.prototype, "props", { set: function() {
          throw Error();
        } }), typeof Reflect == "object" && Reflect.construct) {
          try {
            Reflect.construct(e, []);
          } catch (u) {
            var n = u;
          }
          Reflect.construct(t, [], e);
        } else {
          try {
            e.call();
          } catch (u) {
            n = u;
          }
          t.call(e.prototype);
        }
        else {
          try {
            throw Error();
          } catch (u) {
            n = u;
          }
          t();
        }
      } catch (u) {
        if (u && n && typeof u.stack == "string") {
          for (var o = u.stack.split(`
`), s = n.stack.split(`
`), i = o.length - 1, a = s.length - 1; 1 <= i && 0 <= a && o[i] !== s[a]; ) a--;
          for (; 1 <= i && 0 <= a; i--, a--) if (o[i] !== s[a]) {
            if (i !== 1 || a !== 1) do
              if (i--, a--, 0 > a || o[i] !== s[a]) {
                var l = `
` + o[i].replace(" at new ", " at ");
                return t.displayName && l.includes("<anonymous>") && (l = l.replace("<anonymous>", t.displayName)), l;
              }
            while (1 <= i && 0 <= a);
            break;
          }
        }
      } finally {
        yu = false, Error.prepareStackTrace = r;
      }
      return (t = t ? t.displayName || t.name : "") ? Ls(t) : "";
    }
    function l0(t) {
      switch (t.tag) {
        case 5:
          return Ls(t.type);
        case 16:
          return Ls("Lazy");
        case 13:
          return Ls("Suspense");
        case 19:
          return Ls("SuspenseList");
        case 0:
        case 2:
        case 15:
          return t = vu(t.type, false), t;
        case 11:
          return t = vu(t.type.render, false), t;
        case 1:
          return t = vu(t.type, true), t;
        default:
          return "";
      }
    }
    function Uu(t) {
      if (t == null) return null;
      if (typeof t == "function") return t.displayName || t.name || null;
      if (typeof t == "string") return t;
      switch (t) {
        case xo:
          return "Fragment";
        case _o:
          return "Portal";
        case zu:
          return "Profiler";
        case Ic:
          return "StrictMode";
        case Wu:
          return "Suspense";
        case Bu:
          return "SuspenseList";
      }
      if (typeof t == "object") switch (t.$$typeof) {
        case Kf:
          return (t.displayName || "Context") + ".Consumer";
        case Zf:
          return (t._context.displayName || "Context") + ".Provider";
        case Pc:
          var e = t.render;
          return t = t.displayName, t || (t = e.displayName || e.name || "", t = t !== "" ? "ForwardRef(" + t + ")" : "ForwardRef"), t;
        case Vc:
          return e = t.displayName || null, e !== null ? e : Uu(t.type) || "Memo";
        case un:
          e = t._payload, t = t._init;
          try {
            return Uu(t(e));
          } catch {
          }
      }
      return null;
    }
    function u0(t) {
      var e = t.type;
      switch (t.tag) {
        case 24:
          return "Cache";
        case 9:
          return (e.displayName || "Context") + ".Consumer";
        case 10:
          return (e._context.displayName || "Context") + ".Provider";
        case 18:
          return "DehydratedFragment";
        case 11:
          return t = e.render, t = t.displayName || t.name || "", e.displayName || (t !== "" ? "ForwardRef(" + t + ")" : "ForwardRef");
        case 7:
          return "Fragment";
        case 5:
          return e;
        case 4:
          return "Portal";
        case 3:
          return "Root";
        case 6:
          return "Text";
        case 16:
          return Uu(e);
        case 8:
          return e === Ic ? "StrictMode" : "Mode";
        case 22:
          return "Offscreen";
        case 12:
          return "Profiler";
        case 21:
          return "Scope";
        case 13:
          return "Suspense";
        case 19:
          return "SuspenseList";
        case 25:
          return "TracingMarker";
        case 1:
        case 0:
        case 17:
        case 2:
        case 14:
        case 15:
          if (typeof e == "function") return e.displayName || e.name || null;
          if (typeof e == "string") return e;
      }
      return null;
    }
    function Tn(t) {
      switch (typeof t) {
        case "boolean":
        case "number":
        case "string":
        case "undefined":
          return t;
        case "object":
          return t;
        default:
          return "";
      }
    }
    function ed(t) {
      var e = t.type;
      return (t = t.nodeName) && t.toLowerCase() === "input" && (e === "checkbox" || e === "radio");
    }
    function c0(t) {
      var e = ed(t) ? "checked" : "value", r = Object.getOwnPropertyDescriptor(t.constructor.prototype, e), n = "" + t[e];
      if (!t.hasOwnProperty(e) && typeof r < "u" && typeof r.get == "function" && typeof r.set == "function") {
        var o = r.get, s = r.set;
        return Object.defineProperty(t, e, { configurable: true, get: function() {
          return o.call(this);
        }, set: function(i) {
          n = "" + i, s.call(this, i);
        } }), Object.defineProperty(t, e, { enumerable: r.enumerable }), { getValue: function() {
          return n;
        }, setValue: function(i) {
          n = "" + i;
        }, stopTracking: function() {
          t._valueTracker = null, delete t[e];
        } };
      }
    }
    function ta(t) {
      t._valueTracker || (t._valueTracker = c0(t));
    }
    function td(t) {
      if (!t) return false;
      var e = t._valueTracker;
      if (!e) return true;
      var r = e.getValue(), n = "";
      return t && (n = ed(t) ? t.checked ? "true" : "false" : t.value), t = n, t !== r ? (e.setValue(t), true) : false;
    }
    function Ea(t) {
      if (t = t || (typeof document < "u" ? document : void 0), typeof t > "u") return null;
      try {
        return t.activeElement || t.body;
      } catch {
        return t.body;
      }
    }
    function Gu(t, e) {
      var r = e.checked;
      return Ne({}, e, { defaultChecked: void 0, defaultValue: void 0, value: void 0, checked: r ?? t._wrapperState.initialChecked });
    }
    function Qp(t, e) {
      var r = e.defaultValue == null ? "" : e.defaultValue, n = e.checked != null ? e.checked : e.defaultChecked;
      r = Tn(e.value != null ? e.value : r), t._wrapperState = { initialChecked: n, initialValue: r, controlled: e.type === "checkbox" || e.type === "radio" ? e.checked != null : e.value != null };
    }
    function rd(t, e) {
      e = e.checked, e != null && Fc(t, "checked", e, false);
    }
    function Qu(t, e) {
      rd(t, e);
      var r = Tn(e.value), n = e.type;
      if (r != null) n === "number" ? (r === 0 && t.value === "" || t.value != r) && (t.value = "" + r) : t.value !== "" + r && (t.value = "" + r);
      else if (n === "submit" || n === "reset") {
        t.removeAttribute("value");
        return;
      }
      e.hasOwnProperty("value") ? Hu(t, e.type, r) : e.hasOwnProperty("defaultValue") && Hu(t, e.type, Tn(e.defaultValue)), e.checked == null && e.defaultChecked != null && (t.defaultChecked = !!e.defaultChecked);
    }
    function Hp(t, e, r) {
      if (e.hasOwnProperty("value") || e.hasOwnProperty("defaultValue")) {
        var n = e.type;
        if (!(n !== "submit" && n !== "reset" || e.value !== void 0 && e.value !== null)) return;
        e = "" + t._wrapperState.initialValue, r || e === t.value || (t.value = e), t.defaultValue = e;
      }
      r = t.name, r !== "" && (t.name = ""), t.defaultChecked = !!t._wrapperState.initialChecked, r !== "" && (t.name = r);
    }
    function Hu(t, e, r) {
      (e !== "number" || Ea(t.ownerDocument) !== t) && (r == null ? t.defaultValue = "" + t._wrapperState.initialValue : t.defaultValue !== "" + r && (t.defaultValue = "" + r));
    }
    var qs = Array.isArray;
    function Eo(t, e, r, n) {
      if (t = t.options, e) {
        e = {};
        for (var o = 0; o < r.length; o++) e["$" + r[o]] = true;
        for (r = 0; r < t.length; r++) o = e.hasOwnProperty("$" + t[r].value), t[r].selected !== o && (t[r].selected = o), o && n && (t[r].defaultSelected = true);
      } else {
        for (r = "" + Tn(r), e = null, o = 0; o < t.length; o++) {
          if (t[o].value === r) {
            t[o].selected = true, n && (t[o].defaultSelected = true);
            return;
          }
          e !== null || t[o].disabled || (e = t[o]);
        }
        e !== null && (e.selected = true);
      }
    }
    function $u(t, e) {
      if (e.dangerouslySetInnerHTML != null) throw Error(P(91));
      return Ne({}, e, { value: void 0, defaultValue: void 0, children: "" + t._wrapperState.initialValue });
    }
    function $p(t, e) {
      var r = e.value;
      if (r == null) {
        if (r = e.children, e = e.defaultValue, r != null) {
          if (e != null) throw Error(P(92));
          if (qs(r)) {
            if (1 < r.length) throw Error(P(93));
            r = r[0];
          }
          e = r;
        }
        e == null && (e = ""), r = e;
      }
      t._wrapperState = { initialValue: Tn(r) };
    }
    function nd(t, e) {
      var r = Tn(e.value), n = Tn(e.defaultValue);
      r != null && (r = "" + r, r !== t.value && (t.value = r), e.defaultValue == null && t.defaultValue !== r && (t.defaultValue = r)), n != null && (t.defaultValue = "" + n);
    }
    function Yp(t) {
      var e = t.textContent;
      e === t._wrapperState.initialValue && e !== "" && e !== null && (t.value = e);
    }
    function od(t) {
      switch (t) {
        case "svg":
          return "http://www.w3.org/2000/svg";
        case "math":
          return "http://www.w3.org/1998/Math/MathML";
        default:
          return "http://www.w3.org/1999/xhtml";
      }
    }
    function Yu(t, e) {
      return t == null || t === "http://www.w3.org/1999/xhtml" ? od(e) : t === "http://www.w3.org/2000/svg" && e === "foreignObject" ? "http://www.w3.org/1999/xhtml" : t;
    }
    var ra, sd = (function(t) {
      return typeof MSApp < "u" && MSApp.execUnsafeLocalFunction ? function(e, r, n, o) {
        MSApp.execUnsafeLocalFunction(function() {
          return t(e, r, n, o);
        });
      } : t;
    })(function(t, e) {
      if (t.namespaceURI !== "http://www.w3.org/2000/svg" || "innerHTML" in t) t.innerHTML = e;
      else {
        for (ra = ra || document.createElement("div"), ra.innerHTML = "<svg>" + e.valueOf().toString() + "</svg>", e = ra.firstChild; t.firstChild; ) t.removeChild(t.firstChild);
        for (; e.firstChild; ) t.appendChild(e.firstChild);
      }
    });
    function Ks(t, e) {
      if (e) {
        var r = t.firstChild;
        if (r && r === t.lastChild && r.nodeType === 3) {
          r.nodeValue = e;
          return;
        }
      }
      t.textContent = e;
    }
    var Ws = { animationIterationCount: true, aspectRatio: true, borderImageOutset: true, borderImageSlice: true, borderImageWidth: true, boxFlex: true, boxFlexGroup: true, boxOrdinalGroup: true, columnCount: true, columns: true, flex: true, flexGrow: true, flexPositive: true, flexShrink: true, flexNegative: true, flexOrder: true, gridArea: true, gridRow: true, gridRowEnd: true, gridRowSpan: true, gridRowStart: true, gridColumn: true, gridColumnEnd: true, gridColumnSpan: true, gridColumnStart: true, fontWeight: true, lineClamp: true, lineHeight: true, opacity: true, order: true, orphans: true, tabSize: true, widows: true, zIndex: true, zoom: true, fillOpacity: true, floodOpacity: true, stopOpacity: true, strokeDasharray: true, strokeDashoffset: true, strokeMiterlimit: true, strokeOpacity: true, strokeWidth: true }, h0 = ["Webkit", "ms", "Moz", "O"];
    Object.keys(Ws).forEach(function(t) {
      h0.forEach(function(e) {
        e = e + t.charAt(0).toUpperCase() + t.substring(1), Ws[e] = Ws[t];
      });
    });
    function id(t, e, r) {
      return e == null || typeof e == "boolean" || e === "" ? "" : r || typeof e != "number" || e === 0 || Ws.hasOwnProperty(t) && Ws[t] ? ("" + e).trim() : e + "px";
    }
    function ad(t, e) {
      t = t.style;
      for (var r in e) if (e.hasOwnProperty(r)) {
        var n = r.indexOf("--") === 0, o = id(r, e[r], n);
        r === "float" && (r = "cssFloat"), n ? t.setProperty(r, o) : t[r] = o;
      }
    }
    var p0 = Ne({ menuitem: true }, { area: true, base: true, br: true, col: true, embed: true, hr: true, img: true, input: true, keygen: true, link: true, meta: true, param: true, source: true, track: true, wbr: true });
    function Xu(t, e) {
      if (e) {
        if (p0[t] && (e.children != null || e.dangerouslySetInnerHTML != null)) throw Error(P(137, t));
        if (e.dangerouslySetInnerHTML != null) {
          if (e.children != null) throw Error(P(60));
          if (typeof e.dangerouslySetInnerHTML != "object" || !("__html" in e.dangerouslySetInnerHTML)) throw Error(P(61));
        }
        if (e.style != null && typeof e.style != "object") throw Error(P(62));
      }
    }
    function Zu(t, e) {
      if (t.indexOf("-") === -1) return typeof e.is == "string";
      switch (t) {
        case "annotation-xml":
        case "color-profile":
        case "font-face":
        case "font-face-src":
        case "font-face-uri":
        case "font-face-format":
        case "font-face-name":
        case "missing-glyph":
          return false;
        default:
          return true;
      }
    }
    var Ku = null;
    function Lc(t) {
      return t = t.target || t.srcElement || window, t.correspondingUseElement && (t = t.correspondingUseElement), t.nodeType === 3 ? t.parentNode : t;
    }
    var Ju = null, bo = null, Do = null;
    function Xp(t) {
      if (t = gi(t)) {
        if (typeof Ju != "function") throw Error(P(280));
        var e = t.stateNode;
        e && (e = nl(e), Ju(t.stateNode, t.type, e));
      }
    }
    function ld(t) {
      bo ? Do ? Do.push(t) : Do = [t] : bo = t;
    }
    function ud() {
      if (bo) {
        var t = bo, e = Do;
        if (Do = bo = null, Xp(t), e) for (t = 0; t < e.length; t++) Xp(e[t]);
      }
    }
    function cd(t, e) {
      return t(e);
    }
    function hd() {
    }
    var wu = false;
    function pd(t, e, r) {
      if (wu) return t(e, r);
      wu = true;
      try {
        return cd(t, e, r);
      } finally {
        wu = false, (bo !== null || Do !== null) && (hd(), ud());
      }
    }
    function Js(t, e) {
      var r = t.stateNode;
      if (r === null) return null;
      var n = nl(r);
      if (n === null) return null;
      r = n[e];
      e: switch (e) {
        case "onClick":
        case "onClickCapture":
        case "onDoubleClick":
        case "onDoubleClickCapture":
        case "onMouseDown":
        case "onMouseDownCapture":
        case "onMouseMove":
        case "onMouseMoveCapture":
        case "onMouseUp":
        case "onMouseUpCapture":
        case "onMouseEnter":
          (n = !n.disabled) || (t = t.type, n = !(t === "button" || t === "input" || t === "select" || t === "textarea")), t = !n;
          break e;
        default:
          t = false;
      }
      if (t) return null;
      if (r && typeof r != "function") throw Error(P(231, e, typeof r));
      return r;
    }
    var ec = false;
    if (Ur) try {
      mo = {}, Object.defineProperty(mo, "passive", { get: function() {
        ec = true;
      } }), window.addEventListener("test", mo, mo), window.removeEventListener("test", mo, mo);
    } catch {
      ec = false;
    }
    var mo;
    function f0(t, e, r, n, o, s, i, a, l) {
      var u = Array.prototype.slice.call(arguments, 3);
      try {
        e.apply(r, u);
      } catch (c) {
        this.onError(c);
      }
    }
    var Bs = false, ba = null, Da = false, tc = null, d0 = { onError: function(t) {
      Bs = true, ba = t;
    } };
    function m0(t, e, r, n, o, s, i, a, l) {
      Bs = false, ba = null, f0.apply(d0, arguments);
    }
    function g0(t, e, r, n, o, s, i, a, l) {
      if (m0.apply(this, arguments), Bs) {
        if (Bs) {
          var u = ba;
          Bs = false, ba = null;
        } else throw Error(P(198));
        Da || (Da = true, tc = u);
      }
    }
    function Kn(t) {
      var e = t, r = t;
      if (t.alternate) for (; e.return; ) e = e.return;
      else {
        t = e;
        do
          e = t, (e.flags & 4098) !== 0 && (r = e.return), t = e.return;
        while (t);
      }
      return e.tag === 3 ? r : null;
    }
    function fd(t) {
      if (t.tag === 13) {
        var e = t.memoizedState;
        if (e === null && (t = t.alternate, t !== null && (e = t.memoizedState)), e !== null) return e.dehydrated;
      }
      return null;
    }
    function Zp(t) {
      if (Kn(t) !== t) throw Error(P(188));
    }
    function _0(t) {
      var e = t.alternate;
      if (!e) {
        if (e = Kn(t), e === null) throw Error(P(188));
        return e !== t ? null : t;
      }
      for (var r = t, n = e; ; ) {
        var o = r.return;
        if (o === null) break;
        var s = o.alternate;
        if (s === null) {
          if (n = o.return, n !== null) {
            r = n;
            continue;
          }
          break;
        }
        if (o.child === s.child) {
          for (s = o.child; s; ) {
            if (s === r) return Zp(o), t;
            if (s === n) return Zp(o), e;
            s = s.sibling;
          }
          throw Error(P(188));
        }
        if (r.return !== n.return) r = o, n = s;
        else {
          for (var i = false, a = o.child; a; ) {
            if (a === r) {
              i = true, r = o, n = s;
              break;
            }
            if (a === n) {
              i = true, n = o, r = s;
              break;
            }
            a = a.sibling;
          }
          if (!i) {
            for (a = s.child; a; ) {
              if (a === r) {
                i = true, r = s, n = o;
                break;
              }
              if (a === n) {
                i = true, n = s, r = o;
                break;
              }
              a = a.sibling;
            }
            if (!i) throw Error(P(189));
          }
        }
        if (r.alternate !== n) throw Error(P(190));
      }
      if (r.tag !== 3) throw Error(P(188));
      return r.stateNode.current === r ? t : e;
    }
    function dd(t) {
      return t = _0(t), t !== null ? md(t) : null;
    }
    function md(t) {
      if (t.tag === 5 || t.tag === 6) return t;
      for (t = t.child; t !== null; ) {
        var e = md(t);
        if (e !== null) return e;
        t = t.sibling;
      }
      return null;
    }
    var gd = Pt.unstable_scheduleCallback, Kp = Pt.unstable_cancelCallback, x0 = Pt.unstable_shouldYield, y0 = Pt.unstable_requestPaint, Me = Pt.unstable_now, v0 = Pt.unstable_getCurrentPriorityLevel, qc = Pt.unstable_ImmediatePriority, _d = Pt.unstable_UserBlockingPriority, Ma = Pt.unstable_NormalPriority, w0 = Pt.unstable_LowPriority, xd = Pt.unstable_IdlePriority, Ja = null, Nr = null;
    function S0(t) {
      if (Nr && typeof Nr.onCommitFiberRoot == "function") try {
        Nr.onCommitFiberRoot(Ja, t, void 0, (t.current.flags & 128) === 128);
      } catch {
      }
    }
    var cr = Math.clz32 ? Math.clz32 : k0, T0 = Math.log, A0 = Math.LN2;
    function k0(t) {
      return t >>>= 0, t === 0 ? 32 : 31 - (T0(t) / A0 | 0) | 0;
    }
    var na = 64, oa = 4194304;
    function js(t) {
      switch (t & -t) {
        case 1:
          return 1;
        case 2:
          return 2;
        case 4:
          return 4;
        case 8:
          return 8;
        case 16:
          return 16;
        case 32:
          return 32;
        case 64:
        case 128:
        case 256:
        case 512:
        case 1024:
        case 2048:
        case 4096:
        case 8192:
        case 16384:
        case 32768:
        case 65536:
        case 131072:
        case 262144:
        case 524288:
        case 1048576:
        case 2097152:
          return t & 4194240;
        case 4194304:
        case 8388608:
        case 16777216:
        case 33554432:
        case 67108864:
          return t & 130023424;
        case 134217728:
          return 134217728;
        case 268435456:
          return 268435456;
        case 536870912:
          return 536870912;
        case 1073741824:
          return 1073741824;
        default:
          return t;
      }
    }
    function Ra(t, e) {
      var r = t.pendingLanes;
      if (r === 0) return 0;
      var n = 0, o = t.suspendedLanes, s = t.pingedLanes, i = r & 268435455;
      if (i !== 0) {
        var a = i & ~o;
        a !== 0 ? n = js(a) : (s &= i, s !== 0 && (n = js(s)));
      } else i = r & ~o, i !== 0 ? n = js(i) : s !== 0 && (n = js(s));
      if (n === 0) return 0;
      if (e !== 0 && e !== n && (e & o) === 0 && (o = n & -n, s = e & -e, o >= s || o === 16 && (s & 4194240) !== 0)) return e;
      if ((n & 4) !== 0 && (n |= r & 16), e = t.entangledLanes, e !== 0) for (t = t.entanglements, e &= n; 0 < e; ) r = 31 - cr(e), o = 1 << r, n |= t[r], e &= ~o;
      return n;
    }
    function C0(t, e) {
      switch (t) {
        case 1:
        case 2:
        case 4:
          return e + 250;
        case 8:
        case 16:
        case 32:
        case 64:
        case 128:
        case 256:
        case 512:
        case 1024:
        case 2048:
        case 4096:
        case 8192:
        case 16384:
        case 32768:
        case 65536:
        case 131072:
        case 262144:
        case 524288:
        case 1048576:
        case 2097152:
          return e + 5e3;
        case 4194304:
        case 8388608:
        case 16777216:
        case 33554432:
        case 67108864:
          return -1;
        case 134217728:
        case 268435456:
        case 536870912:
        case 1073741824:
          return -1;
        default:
          return -1;
      }
    }
    function N0(t, e) {
      for (var r = t.suspendedLanes, n = t.pingedLanes, o = t.expirationTimes, s = t.pendingLanes; 0 < s; ) {
        var i = 31 - cr(s), a = 1 << i, l = o[i];
        l === -1 ? ((a & r) === 0 || (a & n) !== 0) && (o[i] = C0(a, e)) : l <= e && (t.expiredLanes |= a), s &= ~a;
      }
    }
    function rc(t) {
      return t = t.pendingLanes & -1073741825, t !== 0 ? t : t & 1073741824 ? 1073741824 : 0;
    }
    function yd() {
      var t = na;
      return na <<= 1, (na & 4194240) === 0 && (na = 64), t;
    }
    function Su(t) {
      for (var e = [], r = 0; 31 > r; r++) e.push(t);
      return e;
    }
    function di(t, e, r) {
      t.pendingLanes |= e, e !== 536870912 && (t.suspendedLanes = 0, t.pingedLanes = 0), t = t.eventTimes, e = 31 - cr(e), t[e] = r;
    }
    function O0(t, e) {
      var r = t.pendingLanes & ~e;
      t.pendingLanes = e, t.suspendedLanes = 0, t.pingedLanes = 0, t.expiredLanes &= e, t.mutableReadLanes &= e, t.entangledLanes &= e, e = t.entanglements;
      var n = t.eventTimes;
      for (t = t.expirationTimes; 0 < r; ) {
        var o = 31 - cr(r), s = 1 << o;
        e[o] = 0, n[o] = -1, t[o] = -1, r &= ~s;
      }
    }
    function jc(t, e) {
      var r = t.entangledLanes |= e;
      for (t = t.entanglements; r; ) {
        var n = 31 - cr(r), o = 1 << n;
        o & e | t[n] & e && (t[n] |= e), r &= ~o;
      }
    }
    var fe = 0;
    function vd(t) {
      return t &= -t, 1 < t ? 4 < t ? (t & 268435455) !== 0 ? 16 : 536870912 : 4 : 1;
    }
    var wd, zc, Sd, Td, Ad, nc = false, sa = [], mn = null, gn = null, _n = null, ei = /* @__PURE__ */ new Map(), ti = /* @__PURE__ */ new Map(), hn = [], E0 = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");
    function Jp(t, e) {
      switch (t) {
        case "focusin":
        case "focusout":
          mn = null;
          break;
        case "dragenter":
        case "dragleave":
          gn = null;
          break;
        case "mouseover":
        case "mouseout":
          _n = null;
          break;
        case "pointerover":
        case "pointerout":
          ei.delete(e.pointerId);
          break;
        case "gotpointercapture":
        case "lostpointercapture":
          ti.delete(e.pointerId);
      }
    }
    function Ds(t, e, r, n, o, s) {
      return t === null || t.nativeEvent !== s ? (t = { blockedOn: e, domEventName: r, eventSystemFlags: n, nativeEvent: s, targetContainers: [o] }, e !== null && (e = gi(e), e !== null && zc(e)), t) : (t.eventSystemFlags |= n, e = t.targetContainers, o !== null && e.indexOf(o) === -1 && e.push(o), t);
    }
    function b0(t, e, r, n, o) {
      switch (e) {
        case "focusin":
          return mn = Ds(mn, t, e, r, n, o), true;
        case "dragenter":
          return gn = Ds(gn, t, e, r, n, o), true;
        case "mouseover":
          return _n = Ds(_n, t, e, r, n, o), true;
        case "pointerover":
          var s = o.pointerId;
          return ei.set(s, Ds(ei.get(s) || null, t, e, r, n, o)), true;
        case "gotpointercapture":
          return s = o.pointerId, ti.set(s, Ds(ti.get(s) || null, t, e, r, n, o)), true;
      }
      return false;
    }
    function kd(t) {
      var e = zn(t.target);
      if (e !== null) {
        var r = Kn(e);
        if (r !== null) {
          if (e = r.tag, e === 13) {
            if (e = fd(r), e !== null) {
              t.blockedOn = e, Ad(t.priority, function() {
                Sd(r);
              });
              return;
            }
          } else if (e === 3 && r.stateNode.current.memoizedState.isDehydrated) {
            t.blockedOn = r.tag === 3 ? r.stateNode.containerInfo : null;
            return;
          }
        }
      }
      t.blockedOn = null;
    }
    function ya(t) {
      if (t.blockedOn !== null) return false;
      for (var e = t.targetContainers; 0 < e.length; ) {
        var r = oc(t.domEventName, t.eventSystemFlags, e[0], t.nativeEvent);
        if (r === null) {
          r = t.nativeEvent;
          var n = new r.constructor(r.type, r);
          Ku = n, r.target.dispatchEvent(n), Ku = null;
        } else return e = gi(r), e !== null && zc(e), t.blockedOn = r, false;
        e.shift();
      }
      return true;
    }
    function ef(t, e, r) {
      ya(t) && r.delete(e);
    }
    function D0() {
      nc = false, mn !== null && ya(mn) && (mn = null), gn !== null && ya(gn) && (gn = null), _n !== null && ya(_n) && (_n = null), ei.forEach(ef), ti.forEach(ef);
    }
    function Ms(t, e) {
      t.blockedOn === e && (t.blockedOn = null, nc || (nc = true, Pt.unstable_scheduleCallback(Pt.unstable_NormalPriority, D0)));
    }
    function ri(t) {
      function e(o) {
        return Ms(o, t);
      }
      if (0 < sa.length) {
        Ms(sa[0], t);
        for (var r = 1; r < sa.length; r++) {
          var n = sa[r];
          n.blockedOn === t && (n.blockedOn = null);
        }
      }
      for (mn !== null && Ms(mn, t), gn !== null && Ms(gn, t), _n !== null && Ms(_n, t), ei.forEach(e), ti.forEach(e), r = 0; r < hn.length; r++) n = hn[r], n.blockedOn === t && (n.blockedOn = null);
      for (; 0 < hn.length && (r = hn[0], r.blockedOn === null); ) kd(r), r.blockedOn === null && hn.shift();
    }
    var Mo = $r.ReactCurrentBatchConfig, Fa = true;
    function M0(t, e, r, n) {
      var o = fe, s = Mo.transition;
      Mo.transition = null;
      try {
        fe = 1, Wc(t, e, r, n);
      } finally {
        fe = o, Mo.transition = s;
      }
    }
    function R0(t, e, r, n) {
      var o = fe, s = Mo.transition;
      Mo.transition = null;
      try {
        fe = 4, Wc(t, e, r, n);
      } finally {
        fe = o, Mo.transition = s;
      }
    }
    function Wc(t, e, r, n) {
      if (Fa) {
        var o = oc(t, e, r, n);
        if (o === null) Eu(t, e, n, Ia, r), Jp(t, n);
        else if (b0(o, t, e, r, n)) n.stopPropagation();
        else if (Jp(t, n), e & 4 && -1 < E0.indexOf(t)) {
          for (; o !== null; ) {
            var s = gi(o);
            if (s !== null && wd(s), s = oc(t, e, r, n), s === null && Eu(t, e, n, Ia, r), s === o) break;
            o = s;
          }
          o !== null && n.stopPropagation();
        } else Eu(t, e, n, null, r);
      }
    }
    var Ia = null;
    function oc(t, e, r, n) {
      if (Ia = null, t = Lc(n), t = zn(t), t !== null) if (e = Kn(t), e === null) t = null;
      else if (r = e.tag, r === 13) {
        if (t = fd(e), t !== null) return t;
        t = null;
      } else if (r === 3) {
        if (e.stateNode.current.memoizedState.isDehydrated) return e.tag === 3 ? e.stateNode.containerInfo : null;
        t = null;
      } else e !== t && (t = null);
      return Ia = t, null;
    }
    function Cd(t) {
      switch (t) {
        case "cancel":
        case "click":
        case "close":
        case "contextmenu":
        case "copy":
        case "cut":
        case "auxclick":
        case "dblclick":
        case "dragend":
        case "dragstart":
        case "drop":
        case "focusin":
        case "focusout":
        case "input":
        case "invalid":
        case "keydown":
        case "keypress":
        case "keyup":
        case "mousedown":
        case "mouseup":
        case "paste":
        case "pause":
        case "play":
        case "pointercancel":
        case "pointerdown":
        case "pointerup":
        case "ratechange":
        case "reset":
        case "resize":
        case "seeked":
        case "submit":
        case "touchcancel":
        case "touchend":
        case "touchstart":
        case "volumechange":
        case "change":
        case "selectionchange":
        case "textInput":
        case "compositionstart":
        case "compositionend":
        case "compositionupdate":
        case "beforeblur":
        case "afterblur":
        case "beforeinput":
        case "blur":
        case "fullscreenchange":
        case "focus":
        case "hashchange":
        case "popstate":
        case "select":
        case "selectstart":
          return 1;
        case "drag":
        case "dragenter":
        case "dragexit":
        case "dragleave":
        case "dragover":
        case "mousemove":
        case "mouseout":
        case "mouseover":
        case "pointermove":
        case "pointerout":
        case "pointerover":
        case "scroll":
        case "toggle":
        case "touchmove":
        case "wheel":
        case "mouseenter":
        case "mouseleave":
        case "pointerenter":
        case "pointerleave":
          return 4;
        case "message":
          switch (v0()) {
            case qc:
              return 1;
            case _d:
              return 4;
            case Ma:
            case w0:
              return 16;
            case xd:
              return 536870912;
            default:
              return 16;
          }
        default:
          return 16;
      }
    }
    var fn = null, Bc = null, va = null;
    function Nd() {
      if (va) return va;
      var t, e = Bc, r = e.length, n, o = "value" in fn ? fn.value : fn.textContent, s = o.length;
      for (t = 0; t < r && e[t] === o[t]; t++) ;
      var i = r - t;
      for (n = 1; n <= i && e[r - n] === o[s - n]; n++) ;
      return va = o.slice(t, 1 < n ? 1 - n : void 0);
    }
    function wa(t) {
      var e = t.keyCode;
      return "charCode" in t ? (t = t.charCode, t === 0 && e === 13 && (t = 13)) : t = e, t === 10 && (t = 13), 32 <= t || t === 13 ? t : 0;
    }
    function ia() {
      return true;
    }
    function tf() {
      return false;
    }
    function Vt(t) {
      function e(r, n, o, s, i) {
        this._reactName = r, this._targetInst = o, this.type = n, this.nativeEvent = s, this.target = i, this.currentTarget = null;
        for (var a in t) t.hasOwnProperty(a) && (r = t[a], this[a] = r ? r(s) : s[a]);
        return this.isDefaultPrevented = (s.defaultPrevented != null ? s.defaultPrevented : s.returnValue === false) ? ia : tf, this.isPropagationStopped = tf, this;
      }
      return Ne(e.prototype, { preventDefault: function() {
        this.defaultPrevented = true;
        var r = this.nativeEvent;
        r && (r.preventDefault ? r.preventDefault() : typeof r.returnValue != "unknown" && (r.returnValue = false), this.isDefaultPrevented = ia);
      }, stopPropagation: function() {
        var r = this.nativeEvent;
        r && (r.stopPropagation ? r.stopPropagation() : typeof r.cancelBubble != "unknown" && (r.cancelBubble = true), this.isPropagationStopped = ia);
      }, persist: function() {
      }, isPersistent: ia }), e;
    }
    var Wo = { eventPhase: 0, bubbles: 0, cancelable: 0, timeStamp: function(t) {
      return t.timeStamp || Date.now();
    }, defaultPrevented: 0, isTrusted: 0 }, Uc = Vt(Wo), mi = Ne({}, Wo, { view: 0, detail: 0 }), F0 = Vt(mi), Tu, Au, Rs, el = Ne({}, mi, { screenX: 0, screenY: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, getModifierState: Gc, button: 0, buttons: 0, relatedTarget: function(t) {
      return t.relatedTarget === void 0 ? t.fromElement === t.srcElement ? t.toElement : t.fromElement : t.relatedTarget;
    }, movementX: function(t) {
      return "movementX" in t ? t.movementX : (t !== Rs && (Rs && t.type === "mousemove" ? (Tu = t.screenX - Rs.screenX, Au = t.screenY - Rs.screenY) : Au = Tu = 0, Rs = t), Tu);
    }, movementY: function(t) {
      return "movementY" in t ? t.movementY : Au;
    } }), rf = Vt(el), I0 = Ne({}, el, { dataTransfer: 0 }), P0 = Vt(I0), V0 = Ne({}, mi, { relatedTarget: 0 }), ku = Vt(V0), L0 = Ne({}, Wo, { animationName: 0, elapsedTime: 0, pseudoElement: 0 }), q0 = Vt(L0), j0 = Ne({}, Wo, { clipboardData: function(t) {
      return "clipboardData" in t ? t.clipboardData : window.clipboardData;
    } }), z0 = Vt(j0), W0 = Ne({}, Wo, { data: 0 }), nf = Vt(W0), B0 = { Esc: "Escape", Spacebar: " ", Left: "ArrowLeft", Up: "ArrowUp", Right: "ArrowRight", Down: "ArrowDown", Del: "Delete", Win: "OS", Menu: "ContextMenu", Apps: "ContextMenu", Scroll: "ScrollLock", MozPrintableKey: "Unidentified" }, U0 = { 8: "Backspace", 9: "Tab", 12: "Clear", 13: "Enter", 16: "Shift", 17: "Control", 18: "Alt", 19: "Pause", 20: "CapsLock", 27: "Escape", 32: " ", 33: "PageUp", 34: "PageDown", 35: "End", 36: "Home", 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown", 45: "Insert", 46: "Delete", 112: "F1", 113: "F2", 114: "F3", 115: "F4", 116: "F5", 117: "F6", 118: "F7", 119: "F8", 120: "F9", 121: "F10", 122: "F11", 123: "F12", 144: "NumLock", 145: "ScrollLock", 224: "Meta" }, G0 = { Alt: "altKey", Control: "ctrlKey", Meta: "metaKey", Shift: "shiftKey" };
    function Q0(t) {
      var e = this.nativeEvent;
      return e.getModifierState ? e.getModifierState(t) : (t = G0[t]) ? !!e[t] : false;
    }
    function Gc() {
      return Q0;
    }
    var H0 = Ne({}, mi, { key: function(t) {
      if (t.key) {
        var e = B0[t.key] || t.key;
        if (e !== "Unidentified") return e;
      }
      return t.type === "keypress" ? (t = wa(t), t === 13 ? "Enter" : String.fromCharCode(t)) : t.type === "keydown" || t.type === "keyup" ? U0[t.keyCode] || "Unidentified" : "";
    }, code: 0, location: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, repeat: 0, locale: 0, getModifierState: Gc, charCode: function(t) {
      return t.type === "keypress" ? wa(t) : 0;
    }, keyCode: function(t) {
      return t.type === "keydown" || t.type === "keyup" ? t.keyCode : 0;
    }, which: function(t) {
      return t.type === "keypress" ? wa(t) : t.type === "keydown" || t.type === "keyup" ? t.keyCode : 0;
    } }), $0 = Vt(H0), Y0 = Ne({}, el, { pointerId: 0, width: 0, height: 0, pressure: 0, tangentialPressure: 0, tiltX: 0, tiltY: 0, twist: 0, pointerType: 0, isPrimary: 0 }), of = Vt(Y0), X0 = Ne({}, mi, { touches: 0, targetTouches: 0, changedTouches: 0, altKey: 0, metaKey: 0, ctrlKey: 0, shiftKey: 0, getModifierState: Gc }), Z0 = Vt(X0), K0 = Ne({}, Wo, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 }), J0 = Vt(K0), ew = Ne({}, el, { deltaX: function(t) {
      return "deltaX" in t ? t.deltaX : "wheelDeltaX" in t ? -t.wheelDeltaX : 0;
    }, deltaY: function(t) {
      return "deltaY" in t ? t.deltaY : "wheelDeltaY" in t ? -t.wheelDeltaY : "wheelDelta" in t ? -t.wheelDelta : 0;
    }, deltaZ: 0, deltaMode: 0 }), tw = Vt(ew), rw = [9, 13, 27, 32], Qc = Ur && "CompositionEvent" in window, Us = null;
    Ur && "documentMode" in document && (Us = document.documentMode);
    var nw = Ur && "TextEvent" in window && !Us, Od = Ur && (!Qc || Us && 8 < Us && 11 >= Us), sf = " ", af = false;
    function Ed(t, e) {
      switch (t) {
        case "keyup":
          return rw.indexOf(e.keyCode) !== -1;
        case "keydown":
          return e.keyCode !== 229;
        case "keypress":
        case "mousedown":
        case "focusout":
          return true;
        default:
          return false;
      }
    }
    function bd(t) {
      return t = t.detail, typeof t == "object" && "data" in t ? t.data : null;
    }
    var yo = false;
    function ow(t, e) {
      switch (t) {
        case "compositionend":
          return bd(e);
        case "keypress":
          return e.which !== 32 ? null : (af = true, sf);
        case "textInput":
          return t = e.data, t === sf && af ? null : t;
        default:
          return null;
      }
    }
    function sw(t, e) {
      if (yo) return t === "compositionend" || !Qc && Ed(t, e) ? (t = Nd(), va = Bc = fn = null, yo = false, t) : null;
      switch (t) {
        case "paste":
          return null;
        case "keypress":
          if (!(e.ctrlKey || e.altKey || e.metaKey) || e.ctrlKey && e.altKey) {
            if (e.char && 1 < e.char.length) return e.char;
            if (e.which) return String.fromCharCode(e.which);
          }
          return null;
        case "compositionend":
          return Od && e.locale !== "ko" ? null : e.data;
        default:
          return null;
      }
    }
    var iw = { color: true, date: true, datetime: true, "datetime-local": true, email: true, month: true, number: true, password: true, range: true, search: true, tel: true, text: true, time: true, url: true, week: true };
    function lf(t) {
      var e = t && t.nodeName && t.nodeName.toLowerCase();
      return e === "input" ? !!iw[t.type] : e === "textarea";
    }
    function Dd(t, e, r, n) {
      ld(n), e = Pa(e, "onChange"), 0 < e.length && (r = new Uc("onChange", "change", null, r, n), t.push({ event: r, listeners: e }));
    }
    var Gs = null, ni = null;
    function aw(t) {
      Wd(t, 0);
    }
    function tl(t) {
      var e = So(t);
      if (td(e)) return t;
    }
    function lw(t, e) {
      if (t === "change") return e;
    }
    var Md = false;
    Ur && (Ur ? (la = "oninput" in document, la || (Cu = document.createElement("div"), Cu.setAttribute("oninput", "return;"), la = typeof Cu.oninput == "function"), aa = la) : aa = false, Md = aa && (!document.documentMode || 9 < document.documentMode));
    var aa, la, Cu;
    function uf() {
      Gs && (Gs.detachEvent("onpropertychange", Rd), ni = Gs = null);
    }
    function Rd(t) {
      if (t.propertyName === "value" && tl(ni)) {
        var e = [];
        Dd(e, ni, t, Lc(t)), pd(aw, e);
      }
    }
    function uw(t, e, r) {
      t === "focusin" ? (uf(), Gs = e, ni = r, Gs.attachEvent("onpropertychange", Rd)) : t === "focusout" && uf();
    }
    function cw(t) {
      if (t === "selectionchange" || t === "keyup" || t === "keydown") return tl(ni);
    }
    function hw(t, e) {
      if (t === "click") return tl(e);
    }
    function pw(t, e) {
      if (t === "input" || t === "change") return tl(e);
    }
    function fw(t, e) {
      return t === e && (t !== 0 || 1 / t === 1 / e) || t !== t && e !== e;
    }
    var pr = typeof Object.is == "function" ? Object.is : fw;
    function oi(t, e) {
      if (pr(t, e)) return true;
      if (typeof t != "object" || t === null || typeof e != "object" || e === null) return false;
      var r = Object.keys(t), n = Object.keys(e);
      if (r.length !== n.length) return false;
      for (n = 0; n < r.length; n++) {
        var o = r[n];
        if (!ju.call(e, o) || !pr(t[o], e[o])) return false;
      }
      return true;
    }
    function cf(t) {
      for (; t && t.firstChild; ) t = t.firstChild;
      return t;
    }
    function hf(t, e) {
      var r = cf(t);
      t = 0;
      for (var n; r; ) {
        if (r.nodeType === 3) {
          if (n = t + r.textContent.length, t <= e && n >= e) return { node: r, offset: e - t };
          t = n;
        }
        e: {
          for (; r; ) {
            if (r.nextSibling) {
              r = r.nextSibling;
              break e;
            }
            r = r.parentNode;
          }
          r = void 0;
        }
        r = cf(r);
      }
    }
    function Fd(t, e) {
      return t && e ? t === e ? true : t && t.nodeType === 3 ? false : e && e.nodeType === 3 ? Fd(t, e.parentNode) : "contains" in t ? t.contains(e) : t.compareDocumentPosition ? !!(t.compareDocumentPosition(e) & 16) : false : false;
    }
    function Id() {
      for (var t = window, e = Ea(); e instanceof t.HTMLIFrameElement; ) {
        try {
          var r = typeof e.contentWindow.location.href == "string";
        } catch {
          r = false;
        }
        if (r) t = e.contentWindow;
        else break;
        e = Ea(t.document);
      }
      return e;
    }
    function Hc(t) {
      var e = t && t.nodeName && t.nodeName.toLowerCase();
      return e && (e === "input" && (t.type === "text" || t.type === "search" || t.type === "tel" || t.type === "url" || t.type === "password") || e === "textarea" || t.contentEditable === "true");
    }
    function dw(t) {
      var e = Id(), r = t.focusedElem, n = t.selectionRange;
      if (e !== r && r && r.ownerDocument && Fd(r.ownerDocument.documentElement, r)) {
        if (n !== null && Hc(r)) {
          if (e = n.start, t = n.end, t === void 0 && (t = e), "selectionStart" in r) r.selectionStart = e, r.selectionEnd = Math.min(t, r.value.length);
          else if (t = (e = r.ownerDocument || document) && e.defaultView || window, t.getSelection) {
            t = t.getSelection();
            var o = r.textContent.length, s = Math.min(n.start, o);
            n = n.end === void 0 ? s : Math.min(n.end, o), !t.extend && s > n && (o = n, n = s, s = o), o = hf(r, s);
            var i = hf(r, n);
            o && i && (t.rangeCount !== 1 || t.anchorNode !== o.node || t.anchorOffset !== o.offset || t.focusNode !== i.node || t.focusOffset !== i.offset) && (e = e.createRange(), e.setStart(o.node, o.offset), t.removeAllRanges(), s > n ? (t.addRange(e), t.extend(i.node, i.offset)) : (e.setEnd(i.node, i.offset), t.addRange(e)));
          }
        }
        for (e = [], t = r; t = t.parentNode; ) t.nodeType === 1 && e.push({ element: t, left: t.scrollLeft, top: t.scrollTop });
        for (typeof r.focus == "function" && r.focus(), r = 0; r < e.length; r++) t = e[r], t.element.scrollLeft = t.left, t.element.scrollTop = t.top;
      }
    }
    var mw = Ur && "documentMode" in document && 11 >= document.documentMode, vo = null, sc = null, Qs = null, ic = false;
    function pf(t, e, r) {
      var n = r.window === r ? r.document : r.nodeType === 9 ? r : r.ownerDocument;
      ic || vo == null || vo !== Ea(n) || (n = vo, "selectionStart" in n && Hc(n) ? n = { start: n.selectionStart, end: n.selectionEnd } : (n = (n.ownerDocument && n.ownerDocument.defaultView || window).getSelection(), n = { anchorNode: n.anchorNode, anchorOffset: n.anchorOffset, focusNode: n.focusNode, focusOffset: n.focusOffset }), Qs && oi(Qs, n) || (Qs = n, n = Pa(sc, "onSelect"), 0 < n.length && (e = new Uc("onSelect", "select", null, e, r), t.push({ event: e, listeners: n }), e.target = vo)));
    }
    function ua(t, e) {
      var r = {};
      return r[t.toLowerCase()] = e.toLowerCase(), r["Webkit" + t] = "webkit" + e, r["Moz" + t] = "moz" + e, r;
    }
    var wo = { animationend: ua("Animation", "AnimationEnd"), animationiteration: ua("Animation", "AnimationIteration"), animationstart: ua("Animation", "AnimationStart"), transitionend: ua("Transition", "TransitionEnd") }, Nu = {}, Pd = {};
    Ur && (Pd = document.createElement("div").style, "AnimationEvent" in window || (delete wo.animationend.animation, delete wo.animationiteration.animation, delete wo.animationstart.animation), "TransitionEvent" in window || delete wo.transitionend.transition);
    function rl(t) {
      if (Nu[t]) return Nu[t];
      if (!wo[t]) return t;
      var e = wo[t], r;
      for (r in e) if (e.hasOwnProperty(r) && r in Pd) return Nu[t] = e[r];
      return t;
    }
    var Vd = rl("animationend"), Ld = rl("animationiteration"), qd = rl("animationstart"), jd = rl("transitionend"), zd = /* @__PURE__ */ new Map(), ff = "abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");
    function kn(t, e) {
      zd.set(t, e), Zn(e, [t]);
    }
    for (ca = 0; ca < ff.length; ca++) ha = ff[ca], df = ha.toLowerCase(), mf = ha[0].toUpperCase() + ha.slice(1), kn(df, "on" + mf);
    var ha, df, mf, ca;
    kn(Vd, "onAnimationEnd");
    kn(Ld, "onAnimationIteration");
    kn(qd, "onAnimationStart");
    kn("dblclick", "onDoubleClick");
    kn("focusin", "onFocus");
    kn("focusout", "onBlur");
    kn(jd, "onTransitionEnd");
    Io("onMouseEnter", ["mouseout", "mouseover"]);
    Io("onMouseLeave", ["mouseout", "mouseover"]);
    Io("onPointerEnter", ["pointerout", "pointerover"]);
    Io("onPointerLeave", ["pointerout", "pointerover"]);
    Zn("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" "));
    Zn("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));
    Zn("onBeforeInput", ["compositionend", "keypress", "textInput", "paste"]);
    Zn("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" "));
    Zn("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" "));
    Zn("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
    var zs = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "), gw = new Set("cancel close invalid load scroll toggle".split(" ").concat(zs));
    function gf(t, e, r) {
      var n = t.type || "unknown-event";
      t.currentTarget = r, g0(n, e, void 0, t), t.currentTarget = null;
    }
    function Wd(t, e) {
      e = (e & 4) !== 0;
      for (var r = 0; r < t.length; r++) {
        var n = t[r], o = n.event;
        n = n.listeners;
        e: {
          var s = void 0;
          if (e) for (var i = n.length - 1; 0 <= i; i--) {
            var a = n[i], l = a.instance, u = a.currentTarget;
            if (a = a.listener, l !== s && o.isPropagationStopped()) break e;
            gf(o, a, u), s = l;
          }
          else for (i = 0; i < n.length; i++) {
            if (a = n[i], l = a.instance, u = a.currentTarget, a = a.listener, l !== s && o.isPropagationStopped()) break e;
            gf(o, a, u), s = l;
          }
        }
      }
      if (Da) throw t = tc, Da = false, tc = null, t;
    }
    function ve(t, e) {
      var r = e[hc];
      r === void 0 && (r = e[hc] = /* @__PURE__ */ new Set());
      var n = t + "__bubble";
      r.has(n) || (Bd(e, t, 2, false), r.add(n));
    }
    function Ou(t, e, r) {
      var n = 0;
      e && (n |= 4), Bd(r, t, n, e);
    }
    var pa = "_reactListening" + Math.random().toString(36).slice(2);
    function si(t) {
      if (!t[pa]) {
        t[pa] = true, Xf.forEach(function(r) {
          r !== "selectionchange" && (gw.has(r) || Ou(r, false, t), Ou(r, true, t));
        });
        var e = t.nodeType === 9 ? t : t.ownerDocument;
        e === null || e[pa] || (e[pa] = true, Ou("selectionchange", false, e));
      }
    }
    function Bd(t, e, r, n) {
      switch (Cd(e)) {
        case 1:
          var o = M0;
          break;
        case 4:
          o = R0;
          break;
        default:
          o = Wc;
      }
      r = o.bind(null, e, r, t), o = void 0, !ec || e !== "touchstart" && e !== "touchmove" && e !== "wheel" || (o = true), n ? o !== void 0 ? t.addEventListener(e, r, { capture: true, passive: o }) : t.addEventListener(e, r, true) : o !== void 0 ? t.addEventListener(e, r, { passive: o }) : t.addEventListener(e, r, false);
    }
    function Eu(t, e, r, n, o) {
      var s = n;
      if ((e & 1) === 0 && (e & 2) === 0 && n !== null) e: for (; ; ) {
        if (n === null) return;
        var i = n.tag;
        if (i === 3 || i === 4) {
          var a = n.stateNode.containerInfo;
          if (a === o || a.nodeType === 8 && a.parentNode === o) break;
          if (i === 4) for (i = n.return; i !== null; ) {
            var l = i.tag;
            if ((l === 3 || l === 4) && (l = i.stateNode.containerInfo, l === o || l.nodeType === 8 && l.parentNode === o)) return;
            i = i.return;
          }
          for (; a !== null; ) {
            if (i = zn(a), i === null) return;
            if (l = i.tag, l === 5 || l === 6) {
              n = s = i;
              continue e;
            }
            a = a.parentNode;
          }
        }
        n = n.return;
      }
      pd(function() {
        var u = s, c = Lc(r), h = [];
        e: {
          var p = zd.get(t);
          if (p !== void 0) {
            var d = Uc, m = t;
            switch (t) {
              case "keypress":
                if (wa(r) === 0) break e;
              case "keydown":
              case "keyup":
                d = $0;
                break;
              case "focusin":
                m = "focus", d = ku;
                break;
              case "focusout":
                m = "blur", d = ku;
                break;
              case "beforeblur":
              case "afterblur":
                d = ku;
                break;
              case "click":
                if (r.button === 2) break e;
              case "auxclick":
              case "dblclick":
              case "mousedown":
              case "mousemove":
              case "mouseup":
              case "mouseout":
              case "mouseover":
              case "contextmenu":
                d = rf;
                break;
              case "drag":
              case "dragend":
              case "dragenter":
              case "dragexit":
              case "dragleave":
              case "dragover":
              case "dragstart":
              case "drop":
                d = P0;
                break;
              case "touchcancel":
              case "touchend":
              case "touchmove":
              case "touchstart":
                d = Z0;
                break;
              case Vd:
              case Ld:
              case qd:
                d = q0;
                break;
              case jd:
                d = J0;
                break;
              case "scroll":
                d = F0;
                break;
              case "wheel":
                d = tw;
                break;
              case "copy":
              case "cut":
              case "paste":
                d = z0;
                break;
              case "gotpointercapture":
              case "lostpointercapture":
              case "pointercancel":
              case "pointerdown":
              case "pointermove":
              case "pointerout":
              case "pointerover":
              case "pointerup":
                d = of;
            }
            var y = (e & 4) !== 0, T = !y && t === "scroll", f = y ? p !== null ? p + "Capture" : null : p;
            y = [];
            for (var g = u, v; g !== null; ) {
              v = g;
              var k = v.stateNode;
              if (v.tag === 5 && k !== null && (v = k, f !== null && (k = Js(g, f), k != null && y.push(ii(g, k, v)))), T) break;
              g = g.return;
            }
            0 < y.length && (p = new d(p, m, null, r, c), h.push({ event: p, listeners: y }));
          }
        }
        if ((e & 7) === 0) {
          e: {
            if (p = t === "mouseover" || t === "pointerover", d = t === "mouseout" || t === "pointerout", p && r !== Ku && (m = r.relatedTarget || r.fromElement) && (zn(m) || m[Gr])) break e;
            if ((d || p) && (p = c.window === c ? c : (p = c.ownerDocument) ? p.defaultView || p.parentWindow : window, d ? (m = r.relatedTarget || r.toElement, d = u, m = m ? zn(m) : null, m !== null && (T = Kn(m), m !== T || m.tag !== 5 && m.tag !== 6) && (m = null)) : (d = null, m = u), d !== m)) {
              if (y = rf, k = "onMouseLeave", f = "onMouseEnter", g = "mouse", (t === "pointerout" || t === "pointerover") && (y = of, k = "onPointerLeave", f = "onPointerEnter", g = "pointer"), T = d == null ? p : So(d), v = m == null ? p : So(m), p = new y(k, g + "leave", d, r, c), p.target = T, p.relatedTarget = v, k = null, zn(c) === u && (y = new y(f, g + "enter", m, r, c), y.target = v, y.relatedTarget = T, k = y), T = k, d && m) t: {
                for (y = d, f = m, g = 0, v = y; v; v = go(v)) g++;
                for (v = 0, k = f; k; k = go(k)) v++;
                for (; 0 < g - v; ) y = go(y), g--;
                for (; 0 < v - g; ) f = go(f), v--;
                for (; g--; ) {
                  if (y === f || f !== null && y === f.alternate) break t;
                  y = go(y), f = go(f);
                }
                y = null;
              }
              else y = null;
              d !== null && _f(h, p, d, y, false), m !== null && T !== null && _f(h, T, m, y, true);
            }
          }
          e: {
            if (p = u ? So(u) : window, d = p.nodeName && p.nodeName.toLowerCase(), d === "select" || d === "input" && p.type === "file") var w = lw;
            else if (lf(p)) if (Md) w = pw;
            else {
              w = cw;
              var A = uw;
            }
            else (d = p.nodeName) && d.toLowerCase() === "input" && (p.type === "checkbox" || p.type === "radio") && (w = hw);
            if (w && (w = w(t, u))) {
              Dd(h, w, r, c);
              break e;
            }
            A && A(t, p, u), t === "focusout" && (A = p._wrapperState) && A.controlled && p.type === "number" && Hu(p, "number", p.value);
          }
          switch (A = u ? So(u) : window, t) {
            case "focusin":
              (lf(A) || A.contentEditable === "true") && (vo = A, sc = u, Qs = null);
              break;
            case "focusout":
              Qs = sc = vo = null;
              break;
            case "mousedown":
              ic = true;
              break;
            case "contextmenu":
            case "mouseup":
            case "dragend":
              ic = false, pf(h, r, c);
              break;
            case "selectionchange":
              if (mw) break;
            case "keydown":
            case "keyup":
              pf(h, r, c);
          }
          var C;
          if (Qc) e: {
            switch (t) {
              case "compositionstart":
                var _ = "onCompositionStart";
                break e;
              case "compositionend":
                _ = "onCompositionEnd";
                break e;
              case "compositionupdate":
                _ = "onCompositionUpdate";
                break e;
            }
            _ = void 0;
          }
          else yo ? Ed(t, r) && (_ = "onCompositionEnd") : t === "keydown" && r.keyCode === 229 && (_ = "onCompositionStart");
          _ && (Od && r.locale !== "ko" && (yo || _ !== "onCompositionStart" ? _ === "onCompositionEnd" && yo && (C = Nd()) : (fn = c, Bc = "value" in fn ? fn.value : fn.textContent, yo = true)), A = Pa(u, _), 0 < A.length && (_ = new nf(_, t, null, r, c), h.push({ event: _, listeners: A }), C ? _.data = C : (C = bd(r), C !== null && (_.data = C)))), (C = nw ? ow(t, r) : sw(t, r)) && (u = Pa(u, "onBeforeInput"), 0 < u.length && (c = new nf("onBeforeInput", "beforeinput", null, r, c), h.push({ event: c, listeners: u }), c.data = C));
        }
        Wd(h, e);
      });
    }
    function ii(t, e, r) {
      return { instance: t, listener: e, currentTarget: r };
    }
    function Pa(t, e) {
      for (var r = e + "Capture", n = []; t !== null; ) {
        var o = t, s = o.stateNode;
        o.tag === 5 && s !== null && (o = s, s = Js(t, r), s != null && n.unshift(ii(t, s, o)), s = Js(t, e), s != null && n.push(ii(t, s, o))), t = t.return;
      }
      return n;
    }
    function go(t) {
      if (t === null) return null;
      do
        t = t.return;
      while (t && t.tag !== 5);
      return t || null;
    }
    function _f(t, e, r, n, o) {
      for (var s = e._reactName, i = []; r !== null && r !== n; ) {
        var a = r, l = a.alternate, u = a.stateNode;
        if (l !== null && l === n) break;
        a.tag === 5 && u !== null && (a = u, o ? (l = Js(r, s), l != null && i.unshift(ii(r, l, a))) : o || (l = Js(r, s), l != null && i.push(ii(r, l, a)))), r = r.return;
      }
      i.length !== 0 && t.push({ event: e, listeners: i });
    }
    var _w = /\r\n?/g, xw = /\u0000|\uFFFD/g;
    function xf(t) {
      return (typeof t == "string" ? t : "" + t).replace(_w, `
`).replace(xw, "");
    }
    function fa(t, e, r) {
      if (e = xf(e), xf(t) !== e && r) throw Error(P(425));
    }
    function Va() {
    }
    var ac = null, lc = null;
    function uc(t, e) {
      return t === "textarea" || t === "noscript" || typeof e.children == "string" || typeof e.children == "number" || typeof e.dangerouslySetInnerHTML == "object" && e.dangerouslySetInnerHTML !== null && e.dangerouslySetInnerHTML.__html != null;
    }
    var cc = typeof setTimeout == "function" ? setTimeout : void 0, yw = typeof clearTimeout == "function" ? clearTimeout : void 0, yf = typeof Promise == "function" ? Promise : void 0, vw = typeof queueMicrotask == "function" ? queueMicrotask : typeof yf < "u" ? function(t) {
      return yf.resolve(null).then(t).catch(ww);
    } : cc;
    function ww(t) {
      setTimeout(function() {
        throw t;
      });
    }
    function bu(t, e) {
      var r = e, n = 0;
      do {
        var o = r.nextSibling;
        if (t.removeChild(r), o && o.nodeType === 8) if (r = o.data, r === "/$") {
          if (n === 0) {
            t.removeChild(o), ri(e);
            return;
          }
          n--;
        } else r !== "$" && r !== "$?" && r !== "$!" || n++;
        r = o;
      } while (r);
      ri(e);
    }
    function xn(t) {
      for (; t != null; t = t.nextSibling) {
        var e = t.nodeType;
        if (e === 1 || e === 3) break;
        if (e === 8) {
          if (e = t.data, e === "$" || e === "$!" || e === "$?") break;
          if (e === "/$") return null;
        }
      }
      return t;
    }
    function vf(t) {
      t = t.previousSibling;
      for (var e = 0; t; ) {
        if (t.nodeType === 8) {
          var r = t.data;
          if (r === "$" || r === "$!" || r === "$?") {
            if (e === 0) return t;
            e--;
          } else r === "/$" && e++;
        }
        t = t.previousSibling;
      }
      return null;
    }
    var Bo = Math.random().toString(36).slice(2), Cr = "__reactFiber$" + Bo, ai = "__reactProps$" + Bo, Gr = "__reactContainer$" + Bo, hc = "__reactEvents$" + Bo, Sw = "__reactListeners$" + Bo, Tw = "__reactHandles$" + Bo;
    function zn(t) {
      var e = t[Cr];
      if (e) return e;
      for (var r = t.parentNode; r; ) {
        if (e = r[Gr] || r[Cr]) {
          if (r = e.alternate, e.child !== null || r !== null && r.child !== null) for (t = vf(t); t !== null; ) {
            if (r = t[Cr]) return r;
            t = vf(t);
          }
          return e;
        }
        t = r, r = t.parentNode;
      }
      return null;
    }
    function gi(t) {
      return t = t[Cr] || t[Gr], !t || t.tag !== 5 && t.tag !== 6 && t.tag !== 13 && t.tag !== 3 ? null : t;
    }
    function So(t) {
      if (t.tag === 5 || t.tag === 6) return t.stateNode;
      throw Error(P(33));
    }
    function nl(t) {
      return t[ai] || null;
    }
    var pc = [], To = -1;
    function Cn(t) {
      return { current: t };
    }
    function we(t) {
      0 > To || (t.current = pc[To], pc[To] = null, To--);
    }
    function xe(t, e) {
      To++, pc[To] = t.current, t.current = e;
    }
    var An = {}, ut = Cn(An), Ct = Cn(false), Qn = An;
    function Po(t, e) {
      var r = t.type.contextTypes;
      if (!r) return An;
      var n = t.stateNode;
      if (n && n.__reactInternalMemoizedUnmaskedChildContext === e) return n.__reactInternalMemoizedMaskedChildContext;
      var o = {}, s;
      for (s in r) o[s] = e[s];
      return n && (t = t.stateNode, t.__reactInternalMemoizedUnmaskedChildContext = e, t.__reactInternalMemoizedMaskedChildContext = o), o;
    }
    function Nt(t) {
      return t = t.childContextTypes, t != null;
    }
    function La() {
      we(Ct), we(ut);
    }
    function wf(t, e, r) {
      if (ut.current !== An) throw Error(P(168));
      xe(ut, e), xe(Ct, r);
    }
    function Ud(t, e, r) {
      var n = t.stateNode;
      if (e = e.childContextTypes, typeof n.getChildContext != "function") return r;
      n = n.getChildContext();
      for (var o in n) if (!(o in e)) throw Error(P(108, u0(t) || "Unknown", o));
      return Ne({}, r, n);
    }
    function qa(t) {
      return t = (t = t.stateNode) && t.__reactInternalMemoizedMergedChildContext || An, Qn = ut.current, xe(ut, t), xe(Ct, Ct.current), true;
    }
    function Sf(t, e, r) {
      var n = t.stateNode;
      if (!n) throw Error(P(169));
      r ? (t = Ud(t, e, Qn), n.__reactInternalMemoizedMergedChildContext = t, we(Ct), we(ut), xe(ut, t)) : we(Ct), xe(Ct, r);
    }
    var jr = null, ol = false, Du = false;
    function Gd(t) {
      jr === null ? jr = [t] : jr.push(t);
    }
    function Aw(t) {
      ol = true, Gd(t);
    }
    function Nn() {
      if (!Du && jr !== null) {
        Du = true;
        var t = 0, e = fe;
        try {
          var r = jr;
          for (fe = 1; t < r.length; t++) {
            var n = r[t];
            do
              n = n(true);
            while (n !== null);
          }
          jr = null, ol = false;
        } catch (o) {
          throw jr !== null && (jr = jr.slice(t + 1)), gd(qc, Nn), o;
        } finally {
          fe = e, Du = false;
        }
      }
      return null;
    }
    var Ao = [], ko = 0, ja = null, za = 0, Ht = [], $t = 0, Hn = null, zr = 1, Wr = "";
    function qn(t, e) {
      Ao[ko++] = za, Ao[ko++] = ja, ja = t, za = e;
    }
    function Qd(t, e, r) {
      Ht[$t++] = zr, Ht[$t++] = Wr, Ht[$t++] = Hn, Hn = t;
      var n = zr;
      t = Wr;
      var o = 32 - cr(n) - 1;
      n &= ~(1 << o), r += 1;
      var s = 32 - cr(e) + o;
      if (30 < s) {
        var i = o - o % 5;
        s = (n & (1 << i) - 1).toString(32), n >>= i, o -= i, zr = 1 << 32 - cr(e) + o | r << o | n, Wr = s + t;
      } else zr = 1 << s | r << o | n, Wr = t;
    }
    function $c(t) {
      t.return !== null && (qn(t, 1), Qd(t, 1, 0));
    }
    function Yc(t) {
      for (; t === ja; ) ja = Ao[--ko], Ao[ko] = null, za = Ao[--ko], Ao[ko] = null;
      for (; t === Hn; ) Hn = Ht[--$t], Ht[$t] = null, Wr = Ht[--$t], Ht[$t] = null, zr = Ht[--$t], Ht[$t] = null;
    }
    var It = null, Ft = null, Se = false, ur = null;
    function Hd(t, e) {
      var r = Yt(5, null, null, 0);
      r.elementType = "DELETED", r.stateNode = e, r.return = t, e = t.deletions, e === null ? (t.deletions = [r], t.flags |= 16) : e.push(r);
    }
    function Tf(t, e) {
      switch (t.tag) {
        case 5:
          var r = t.type;
          return e = e.nodeType !== 1 || r.toLowerCase() !== e.nodeName.toLowerCase() ? null : e, e !== null ? (t.stateNode = e, It = t, Ft = xn(e.firstChild), true) : false;
        case 6:
          return e = t.pendingProps === "" || e.nodeType !== 3 ? null : e, e !== null ? (t.stateNode = e, It = t, Ft = null, true) : false;
        case 13:
          return e = e.nodeType !== 8 ? null : e, e !== null ? (r = Hn !== null ? { id: zr, overflow: Wr } : null, t.memoizedState = { dehydrated: e, treeContext: r, retryLane: 1073741824 }, r = Yt(18, null, null, 0), r.stateNode = e, r.return = t, t.child = r, It = t, Ft = null, true) : false;
        default:
          return false;
      }
    }
    function fc(t) {
      return (t.mode & 1) !== 0 && (t.flags & 128) === 0;
    }
    function dc(t) {
      if (Se) {
        var e = Ft;
        if (e) {
          var r = e;
          if (!Tf(t, e)) {
            if (fc(t)) throw Error(P(418));
            e = xn(r.nextSibling);
            var n = It;
            e && Tf(t, e) ? Hd(n, r) : (t.flags = t.flags & -4097 | 2, Se = false, It = t);
          }
        } else {
          if (fc(t)) throw Error(P(418));
          t.flags = t.flags & -4097 | 2, Se = false, It = t;
        }
      }
    }
    function Af(t) {
      for (t = t.return; t !== null && t.tag !== 5 && t.tag !== 3 && t.tag !== 13; ) t = t.return;
      It = t;
    }
    function da(t) {
      if (t !== It) return false;
      if (!Se) return Af(t), Se = true, false;
      var e;
      if ((e = t.tag !== 3) && !(e = t.tag !== 5) && (e = t.type, e = e !== "head" && e !== "body" && !uc(t.type, t.memoizedProps)), e && (e = Ft)) {
        if (fc(t)) throw $d(), Error(P(418));
        for (; e; ) Hd(t, e), e = xn(e.nextSibling);
      }
      if (Af(t), t.tag === 13) {
        if (t = t.memoizedState, t = t !== null ? t.dehydrated : null, !t) throw Error(P(317));
        e: {
          for (t = t.nextSibling, e = 0; t; ) {
            if (t.nodeType === 8) {
              var r = t.data;
              if (r === "/$") {
                if (e === 0) {
                  Ft = xn(t.nextSibling);
                  break e;
                }
                e--;
              } else r !== "$" && r !== "$!" && r !== "$?" || e++;
            }
            t = t.nextSibling;
          }
          Ft = null;
        }
      } else Ft = It ? xn(t.stateNode.nextSibling) : null;
      return true;
    }
    function $d() {
      for (var t = Ft; t; ) t = xn(t.nextSibling);
    }
    function Vo() {
      Ft = It = null, Se = false;
    }
    function Xc(t) {
      ur === null ? ur = [t] : ur.push(t);
    }
    var kw = $r.ReactCurrentBatchConfig;
    function Fs(t, e, r) {
      if (t = r.ref, t !== null && typeof t != "function" && typeof t != "object") {
        if (r._owner) {
          if (r = r._owner, r) {
            if (r.tag !== 1) throw Error(P(309));
            var n = r.stateNode;
          }
          if (!n) throw Error(P(147, t));
          var o = n, s = "" + t;
          return e !== null && e.ref !== null && typeof e.ref == "function" && e.ref._stringRef === s ? e.ref : (e = function(i) {
            var a = o.refs;
            i === null ? delete a[s] : a[s] = i;
          }, e._stringRef = s, e);
        }
        if (typeof t != "string") throw Error(P(284));
        if (!r._owner) throw Error(P(290, t));
      }
      return t;
    }
    function ma(t, e) {
      throw t = Object.prototype.toString.call(e), Error(P(31, t === "[object Object]" ? "object with keys {" + Object.keys(e).join(", ") + "}" : t));
    }
    function kf(t) {
      var e = t._init;
      return e(t._payload);
    }
    function Yd(t) {
      function e(f, g) {
        if (t) {
          var v = f.deletions;
          v === null ? (f.deletions = [g], f.flags |= 16) : v.push(g);
        }
      }
      function r(f, g) {
        if (!t) return null;
        for (; g !== null; ) e(f, g), g = g.sibling;
        return null;
      }
      function n(f, g) {
        for (f = /* @__PURE__ */ new Map(); g !== null; ) g.key !== null ? f.set(g.key, g) : f.set(g.index, g), g = g.sibling;
        return f;
      }
      function o(f, g) {
        return f = Sn(f, g), f.index = 0, f.sibling = null, f;
      }
      function s(f, g, v) {
        return f.index = v, t ? (v = f.alternate, v !== null ? (v = v.index, v < g ? (f.flags |= 2, g) : v) : (f.flags |= 2, g)) : (f.flags |= 1048576, g);
      }
      function i(f) {
        return t && f.alternate === null && (f.flags |= 2), f;
      }
      function a(f, g, v, k) {
        return g === null || g.tag !== 6 ? (g = Lu(v, f.mode, k), g.return = f, g) : (g = o(g, v), g.return = f, g);
      }
      function l(f, g, v, k) {
        var w = v.type;
        return w === xo ? c(f, g, v.props.children, k, v.key) : g !== null && (g.elementType === w || typeof w == "object" && w !== null && w.$$typeof === un && kf(w) === g.type) ? (k = o(g, v.props), k.ref = Fs(f, g, v), k.return = f, k) : (k = Oa(v.type, v.key, v.props, null, f.mode, k), k.ref = Fs(f, g, v), k.return = f, k);
      }
      function u(f, g, v, k) {
        return g === null || g.tag !== 4 || g.stateNode.containerInfo !== v.containerInfo || g.stateNode.implementation !== v.implementation ? (g = qu(v, f.mode, k), g.return = f, g) : (g = o(g, v.children || []), g.return = f, g);
      }
      function c(f, g, v, k, w) {
        return g === null || g.tag !== 7 ? (g = Gn(v, f.mode, k, w), g.return = f, g) : (g = o(g, v), g.return = f, g);
      }
      function h(f, g, v) {
        if (typeof g == "string" && g !== "" || typeof g == "number") return g = Lu("" + g, f.mode, v), g.return = f, g;
        if (typeof g == "object" && g !== null) {
          switch (g.$$typeof) {
            case ea:
              return v = Oa(g.type, g.key, g.props, null, f.mode, v), v.ref = Fs(f, null, g), v.return = f, v;
            case _o:
              return g = qu(g, f.mode, v), g.return = f, g;
            case un:
              var k = g._init;
              return h(f, k(g._payload), v);
          }
          if (qs(g) || bs(g)) return g = Gn(g, f.mode, v, null), g.return = f, g;
          ma(f, g);
        }
        return null;
      }
      function p(f, g, v, k) {
        var w = g !== null ? g.key : null;
        if (typeof v == "string" && v !== "" || typeof v == "number") return w !== null ? null : a(f, g, "" + v, k);
        if (typeof v == "object" && v !== null) {
          switch (v.$$typeof) {
            case ea:
              return v.key === w ? l(f, g, v, k) : null;
            case _o:
              return v.key === w ? u(f, g, v, k) : null;
            case un:
              return w = v._init, p(f, g, w(v._payload), k);
          }
          if (qs(v) || bs(v)) return w !== null ? null : c(f, g, v, k, null);
          ma(f, v);
        }
        return null;
      }
      function d(f, g, v, k, w) {
        if (typeof k == "string" && k !== "" || typeof k == "number") return f = f.get(v) || null, a(g, f, "" + k, w);
        if (typeof k == "object" && k !== null) {
          switch (k.$$typeof) {
            case ea:
              return f = f.get(k.key === null ? v : k.key) || null, l(g, f, k, w);
            case _o:
              return f = f.get(k.key === null ? v : k.key) || null, u(g, f, k, w);
            case un:
              var A = k._init;
              return d(f, g, v, A(k._payload), w);
          }
          if (qs(k) || bs(k)) return f = f.get(v) || null, c(g, f, k, w, null);
          ma(g, k);
        }
        return null;
      }
      function m(f, g, v, k) {
        for (var w = null, A = null, C = g, _ = g = 0, x = null; C !== null && _ < v.length; _++) {
          C.index > _ ? (x = C, C = null) : x = C.sibling;
          var E = p(f, C, v[_], k);
          if (E === null) {
            C === null && (C = x);
            break;
          }
          t && C && E.alternate === null && e(f, C), g = s(E, g, _), A === null ? w = E : A.sibling = E, A = E, C = x;
        }
        if (_ === v.length) return r(f, C), Se && qn(f, _), w;
        if (C === null) {
          for (; _ < v.length; _++) C = h(f, v[_], k), C !== null && (g = s(C, g, _), A === null ? w = C : A.sibling = C, A = C);
          return Se && qn(f, _), w;
        }
        for (C = n(f, C); _ < v.length; _++) x = d(C, f, _, v[_], k), x !== null && (t && x.alternate !== null && C.delete(x.key === null ? _ : x.key), g = s(x, g, _), A === null ? w = x : A.sibling = x, A = x);
        return t && C.forEach(function(D) {
          return e(f, D);
        }), Se && qn(f, _), w;
      }
      function y(f, g, v, k) {
        var w = bs(v);
        if (typeof w != "function") throw Error(P(150));
        if (v = w.call(v), v == null) throw Error(P(151));
        for (var A = w = null, C = g, _ = g = 0, x = null, E = v.next(); C !== null && !E.done; _++, E = v.next()) {
          C.index > _ ? (x = C, C = null) : x = C.sibling;
          var D = p(f, C, E.value, k);
          if (D === null) {
            C === null && (C = x);
            break;
          }
          t && C && D.alternate === null && e(f, C), g = s(D, g, _), A === null ? w = D : A.sibling = D, A = D, C = x;
        }
        if (E.done) return r(f, C), Se && qn(f, _), w;
        if (C === null) {
          for (; !E.done; _++, E = v.next()) E = h(f, E.value, k), E !== null && (g = s(E, g, _), A === null ? w = E : A.sibling = E, A = E);
          return Se && qn(f, _), w;
        }
        for (C = n(f, C); !E.done; _++, E = v.next()) E = d(C, f, _, E.value, k), E !== null && (t && E.alternate !== null && C.delete(E.key === null ? _ : E.key), g = s(E, g, _), A === null ? w = E : A.sibling = E, A = E);
        return t && C.forEach(function(F) {
          return e(f, F);
        }), Se && qn(f, _), w;
      }
      function T(f, g, v, k) {
        if (typeof v == "object" && v !== null && v.type === xo && v.key === null && (v = v.props.children), typeof v == "object" && v !== null) {
          switch (v.$$typeof) {
            case ea:
              e: {
                for (var w = v.key, A = g; A !== null; ) {
                  if (A.key === w) {
                    if (w = v.type, w === xo) {
                      if (A.tag === 7) {
                        r(f, A.sibling), g = o(A, v.props.children), g.return = f, f = g;
                        break e;
                      }
                    } else if (A.elementType === w || typeof w == "object" && w !== null && w.$$typeof === un && kf(w) === A.type) {
                      r(f, A.sibling), g = o(A, v.props), g.ref = Fs(f, A, v), g.return = f, f = g;
                      break e;
                    }
                    r(f, A);
                    break;
                  } else e(f, A);
                  A = A.sibling;
                }
                v.type === xo ? (g = Gn(v.props.children, f.mode, k, v.key), g.return = f, f = g) : (k = Oa(v.type, v.key, v.props, null, f.mode, k), k.ref = Fs(f, g, v), k.return = f, f = k);
              }
              return i(f);
            case _o:
              e: {
                for (A = v.key; g !== null; ) {
                  if (g.key === A) if (g.tag === 4 && g.stateNode.containerInfo === v.containerInfo && g.stateNode.implementation === v.implementation) {
                    r(f, g.sibling), g = o(g, v.children || []), g.return = f, f = g;
                    break e;
                  } else {
                    r(f, g);
                    break;
                  }
                  else e(f, g);
                  g = g.sibling;
                }
                g = qu(v, f.mode, k), g.return = f, f = g;
              }
              return i(f);
            case un:
              return A = v._init, T(f, g, A(v._payload), k);
          }
          if (qs(v)) return m(f, g, v, k);
          if (bs(v)) return y(f, g, v, k);
          ma(f, v);
        }
        return typeof v == "string" && v !== "" || typeof v == "number" ? (v = "" + v, g !== null && g.tag === 6 ? (r(f, g.sibling), g = o(g, v), g.return = f, f = g) : (r(f, g), g = Lu(v, f.mode, k), g.return = f, f = g), i(f)) : r(f, g);
      }
      return T;
    }
    var Lo = Yd(true), Xd = Yd(false), Wa = Cn(null), Ba = null, Co = null, Zc = null;
    function Kc() {
      Zc = Co = Ba = null;
    }
    function Jc(t) {
      var e = Wa.current;
      we(Wa), t._currentValue = e;
    }
    function mc(t, e, r) {
      for (; t !== null; ) {
        var n = t.alternate;
        if ((t.childLanes & e) !== e ? (t.childLanes |= e, n !== null && (n.childLanes |= e)) : n !== null && (n.childLanes & e) !== e && (n.childLanes |= e), t === r) break;
        t = t.return;
      }
    }
    function Ro(t, e) {
      Ba = t, Zc = Co = null, t = t.dependencies, t !== null && t.firstContext !== null && ((t.lanes & e) !== 0 && (kt = true), t.firstContext = null);
    }
    function Zt(t) {
      var e = t._currentValue;
      if (Zc !== t) if (t = { context: t, memoizedValue: e, next: null }, Co === null) {
        if (Ba === null) throw Error(P(308));
        Co = t, Ba.dependencies = { lanes: 0, firstContext: t };
      } else Co = Co.next = t;
      return e;
    }
    var Wn = null;
    function eh(t) {
      Wn === null ? Wn = [t] : Wn.push(t);
    }
    function Zd(t, e, r, n) {
      var o = e.interleaved;
      return o === null ? (r.next = r, eh(e)) : (r.next = o.next, o.next = r), e.interleaved = r, Qr(t, n);
    }
    function Qr(t, e) {
      t.lanes |= e;
      var r = t.alternate;
      for (r !== null && (r.lanes |= e), r = t, t = t.return; t !== null; ) t.childLanes |= e, r = t.alternate, r !== null && (r.childLanes |= e), r = t, t = t.return;
      return r.tag === 3 ? r.stateNode : null;
    }
    var cn = false;
    function th(t) {
      t.updateQueue = { baseState: t.memoizedState, firstBaseUpdate: null, lastBaseUpdate: null, shared: { pending: null, interleaved: null, lanes: 0 }, effects: null };
    }
    function Kd(t, e) {
      t = t.updateQueue, e.updateQueue === t && (e.updateQueue = { baseState: t.baseState, firstBaseUpdate: t.firstBaseUpdate, lastBaseUpdate: t.lastBaseUpdate, shared: t.shared, effects: t.effects });
    }
    function Br(t, e) {
      return { eventTime: t, lane: e, tag: 0, payload: null, callback: null, next: null };
    }
    function yn(t, e, r) {
      var n = t.updateQueue;
      if (n === null) return null;
      if (n = n.shared, (se & 2) !== 0) {
        var o = n.pending;
        return o === null ? e.next = e : (e.next = o.next, o.next = e), n.pending = e, Qr(t, r);
      }
      return o = n.interleaved, o === null ? (e.next = e, eh(n)) : (e.next = o.next, o.next = e), n.interleaved = e, Qr(t, r);
    }
    function Sa(t, e, r) {
      if (e = e.updateQueue, e !== null && (e = e.shared, (r & 4194240) !== 0)) {
        var n = e.lanes;
        n &= t.pendingLanes, r |= n, e.lanes = r, jc(t, r);
      }
    }
    function Cf(t, e) {
      var r = t.updateQueue, n = t.alternate;
      if (n !== null && (n = n.updateQueue, r === n)) {
        var o = null, s = null;
        if (r = r.firstBaseUpdate, r !== null) {
          do {
            var i = { eventTime: r.eventTime, lane: r.lane, tag: r.tag, payload: r.payload, callback: r.callback, next: null };
            s === null ? o = s = i : s = s.next = i, r = r.next;
          } while (r !== null);
          s === null ? o = s = e : s = s.next = e;
        } else o = s = e;
        r = { baseState: n.baseState, firstBaseUpdate: o, lastBaseUpdate: s, shared: n.shared, effects: n.effects }, t.updateQueue = r;
        return;
      }
      t = r.lastBaseUpdate, t === null ? r.firstBaseUpdate = e : t.next = e, r.lastBaseUpdate = e;
    }
    function Ua(t, e, r, n) {
      var o = t.updateQueue;
      cn = false;
      var s = o.firstBaseUpdate, i = o.lastBaseUpdate, a = o.shared.pending;
      if (a !== null) {
        o.shared.pending = null;
        var l = a, u = l.next;
        l.next = null, i === null ? s = u : i.next = u, i = l;
        var c = t.alternate;
        c !== null && (c = c.updateQueue, a = c.lastBaseUpdate, a !== i && (a === null ? c.firstBaseUpdate = u : a.next = u, c.lastBaseUpdate = l));
      }
      if (s !== null) {
        var h = o.baseState;
        i = 0, c = u = l = null, a = s;
        do {
          var p = a.lane, d = a.eventTime;
          if ((n & p) === p) {
            c !== null && (c = c.next = { eventTime: d, lane: 0, tag: a.tag, payload: a.payload, callback: a.callback, next: null });
            e: {
              var m = t, y = a;
              switch (p = e, d = r, y.tag) {
                case 1:
                  if (m = y.payload, typeof m == "function") {
                    h = m.call(d, h, p);
                    break e;
                  }
                  h = m;
                  break e;
                case 3:
                  m.flags = m.flags & -65537 | 128;
                case 0:
                  if (m = y.payload, p = typeof m == "function" ? m.call(d, h, p) : m, p == null) break e;
                  h = Ne({}, h, p);
                  break e;
                case 2:
                  cn = true;
              }
            }
            a.callback !== null && a.lane !== 0 && (t.flags |= 64, p = o.effects, p === null ? o.effects = [a] : p.push(a));
          } else d = { eventTime: d, lane: p, tag: a.tag, payload: a.payload, callback: a.callback, next: null }, c === null ? (u = c = d, l = h) : c = c.next = d, i |= p;
          if (a = a.next, a === null) {
            if (a = o.shared.pending, a === null) break;
            p = a, a = p.next, p.next = null, o.lastBaseUpdate = p, o.shared.pending = null;
          }
        } while (true);
        if (c === null && (l = h), o.baseState = l, o.firstBaseUpdate = u, o.lastBaseUpdate = c, e = o.shared.interleaved, e !== null) {
          o = e;
          do
            i |= o.lane, o = o.next;
          while (o !== e);
        } else s === null && (o.shared.lanes = 0);
        Yn |= i, t.lanes = i, t.memoizedState = h;
      }
    }
    function Nf(t, e, r) {
      if (t = e.effects, e.effects = null, t !== null) for (e = 0; e < t.length; e++) {
        var n = t[e], o = n.callback;
        if (o !== null) {
          if (n.callback = null, n = r, typeof o != "function") throw Error(P(191, o));
          o.call(n);
        }
      }
    }
    var _i = {}, Or = Cn(_i), li = Cn(_i), ui = Cn(_i);
    function Bn(t) {
      if (t === _i) throw Error(P(174));
      return t;
    }
    function rh(t, e) {
      switch (xe(ui, e), xe(li, t), xe(Or, _i), t = e.nodeType, t) {
        case 9:
        case 11:
          e = (e = e.documentElement) ? e.namespaceURI : Yu(null, "");
          break;
        default:
          t = t === 8 ? e.parentNode : e, e = t.namespaceURI || null, t = t.tagName, e = Yu(e, t);
      }
      we(Or), xe(Or, e);
    }
    function qo() {
      we(Or), we(li), we(ui);
    }
    function Jd(t) {
      Bn(ui.current);
      var e = Bn(Or.current), r = Yu(e, t.type);
      e !== r && (xe(li, t), xe(Or, r));
    }
    function nh(t) {
      li.current === t && (we(Or), we(li));
    }
    var ke = Cn(0);
    function Ga(t) {
      for (var e = t; e !== null; ) {
        if (e.tag === 13) {
          var r = e.memoizedState;
          if (r !== null && (r = r.dehydrated, r === null || r.data === "$?" || r.data === "$!")) return e;
        } else if (e.tag === 19 && e.memoizedProps.revealOrder !== void 0) {
          if ((e.flags & 128) !== 0) return e;
        } else if (e.child !== null) {
          e.child.return = e, e = e.child;
          continue;
        }
        if (e === t) break;
        for (; e.sibling === null; ) {
          if (e.return === null || e.return === t) return null;
          e = e.return;
        }
        e.sibling.return = e.return, e = e.sibling;
      }
      return null;
    }
    var Mu = [];
    function oh() {
      for (var t = 0; t < Mu.length; t++) Mu[t]._workInProgressVersionPrimary = null;
      Mu.length = 0;
    }
    var Ta = $r.ReactCurrentDispatcher, Ru = $r.ReactCurrentBatchConfig, $n = 0, Ce = null, Ge = null, Xe = null, Qa = false, Hs = false, ci = 0, Cw = 0;
    function it() {
      throw Error(P(321));
    }
    function sh(t, e) {
      if (e === null) return false;
      for (var r = 0; r < e.length && r < t.length; r++) if (!pr(t[r], e[r])) return false;
      return true;
    }
    function ih(t, e, r, n, o, s) {
      if ($n = s, Ce = e, e.memoizedState = null, e.updateQueue = null, e.lanes = 0, Ta.current = t === null || t.memoizedState === null ? bw : Dw, t = r(n, o), Hs) {
        s = 0;
        do {
          if (Hs = false, ci = 0, 25 <= s) throw Error(P(301));
          s += 1, Xe = Ge = null, e.updateQueue = null, Ta.current = Mw, t = r(n, o);
        } while (Hs);
      }
      if (Ta.current = Ha, e = Ge !== null && Ge.next !== null, $n = 0, Xe = Ge = Ce = null, Qa = false, e) throw Error(P(300));
      return t;
    }
    function ah() {
      var t = ci !== 0;
      return ci = 0, t;
    }
    function kr() {
      var t = { memoizedState: null, baseState: null, baseQueue: null, queue: null, next: null };
      return Xe === null ? Ce.memoizedState = Xe = t : Xe = Xe.next = t, Xe;
    }
    function Kt() {
      if (Ge === null) {
        var t = Ce.alternate;
        t = t !== null ? t.memoizedState : null;
      } else t = Ge.next;
      var e = Xe === null ? Ce.memoizedState : Xe.next;
      if (e !== null) Xe = e, Ge = t;
      else {
        if (t === null) throw Error(P(310));
        Ge = t, t = { memoizedState: Ge.memoizedState, baseState: Ge.baseState, baseQueue: Ge.baseQueue, queue: Ge.queue, next: null }, Xe === null ? Ce.memoizedState = Xe = t : Xe = Xe.next = t;
      }
      return Xe;
    }
    function hi(t, e) {
      return typeof e == "function" ? e(t) : e;
    }
    function Fu(t) {
      var e = Kt(), r = e.queue;
      if (r === null) throw Error(P(311));
      r.lastRenderedReducer = t;
      var n = Ge, o = n.baseQueue, s = r.pending;
      if (s !== null) {
        if (o !== null) {
          var i = o.next;
          o.next = s.next, s.next = i;
        }
        n.baseQueue = o = s, r.pending = null;
      }
      if (o !== null) {
        s = o.next, n = n.baseState;
        var a = i = null, l = null, u = s;
        do {
          var c = u.lane;
          if (($n & c) === c) l !== null && (l = l.next = { lane: 0, action: u.action, hasEagerState: u.hasEagerState, eagerState: u.eagerState, next: null }), n = u.hasEagerState ? u.eagerState : t(n, u.action);
          else {
            var h = { lane: c, action: u.action, hasEagerState: u.hasEagerState, eagerState: u.eagerState, next: null };
            l === null ? (a = l = h, i = n) : l = l.next = h, Ce.lanes |= c, Yn |= c;
          }
          u = u.next;
        } while (u !== null && u !== s);
        l === null ? i = n : l.next = a, pr(n, e.memoizedState) || (kt = true), e.memoizedState = n, e.baseState = i, e.baseQueue = l, r.lastRenderedState = n;
      }
      if (t = r.interleaved, t !== null) {
        o = t;
        do
          s = o.lane, Ce.lanes |= s, Yn |= s, o = o.next;
        while (o !== t);
      } else o === null && (r.lanes = 0);
      return [e.memoizedState, r.dispatch];
    }
    function Iu(t) {
      var e = Kt(), r = e.queue;
      if (r === null) throw Error(P(311));
      r.lastRenderedReducer = t;
      var n = r.dispatch, o = r.pending, s = e.memoizedState;
      if (o !== null) {
        r.pending = null;
        var i = o = o.next;
        do
          s = t(s, i.action), i = i.next;
        while (i !== o);
        pr(s, e.memoizedState) || (kt = true), e.memoizedState = s, e.baseQueue === null && (e.baseState = s), r.lastRenderedState = s;
      }
      return [s, n];
    }
    function em() {
    }
    function tm(t, e) {
      var r = Ce, n = Kt(), o = e(), s = !pr(n.memoizedState, o);
      if (s && (n.memoizedState = o, kt = true), n = n.queue, lh(om.bind(null, r, n, t), [t]), n.getSnapshot !== e || s || Xe !== null && Xe.memoizedState.tag & 1) {
        if (r.flags |= 2048, pi(9, nm.bind(null, r, n, o, e), void 0, null), Ze === null) throw Error(P(349));
        ($n & 30) !== 0 || rm(r, e, o);
      }
      return o;
    }
    function rm(t, e, r) {
      t.flags |= 16384, t = { getSnapshot: e, value: r }, e = Ce.updateQueue, e === null ? (e = { lastEffect: null, stores: null }, Ce.updateQueue = e, e.stores = [t]) : (r = e.stores, r === null ? e.stores = [t] : r.push(t));
    }
    function nm(t, e, r, n) {
      e.value = r, e.getSnapshot = n, sm(e) && im(t);
    }
    function om(t, e, r) {
      return r(function() {
        sm(e) && im(t);
      });
    }
    function sm(t) {
      var e = t.getSnapshot;
      t = t.value;
      try {
        var r = e();
        return !pr(t, r);
      } catch {
        return true;
      }
    }
    function im(t) {
      var e = Qr(t, 1);
      e !== null && hr(e, t, 1, -1);
    }
    function Of(t) {
      var e = kr();
      return typeof t == "function" && (t = t()), e.memoizedState = e.baseState = t, t = { pending: null, interleaved: null, lanes: 0, dispatch: null, lastRenderedReducer: hi, lastRenderedState: t }, e.queue = t, t = t.dispatch = Ew.bind(null, Ce, t), [e.memoizedState, t];
    }
    function pi(t, e, r, n) {
      return t = { tag: t, create: e, destroy: r, deps: n, next: null }, e = Ce.updateQueue, e === null ? (e = { lastEffect: null, stores: null }, Ce.updateQueue = e, e.lastEffect = t.next = t) : (r = e.lastEffect, r === null ? e.lastEffect = t.next = t : (n = r.next, r.next = t, t.next = n, e.lastEffect = t)), t;
    }
    function am() {
      return Kt().memoizedState;
    }
    function Aa(t, e, r, n) {
      var o = kr();
      Ce.flags |= t, o.memoizedState = pi(1 | e, r, void 0, n === void 0 ? null : n);
    }
    function sl(t, e, r, n) {
      var o = Kt();
      n = n === void 0 ? null : n;
      var s = void 0;
      if (Ge !== null) {
        var i = Ge.memoizedState;
        if (s = i.destroy, n !== null && sh(n, i.deps)) {
          o.memoizedState = pi(e, r, s, n);
          return;
        }
      }
      Ce.flags |= t, o.memoizedState = pi(1 | e, r, s, n);
    }
    function Ef(t, e) {
      return Aa(8390656, 8, t, e);
    }
    function lh(t, e) {
      return sl(2048, 8, t, e);
    }
    function lm(t, e) {
      return sl(4, 2, t, e);
    }
    function um(t, e) {
      return sl(4, 4, t, e);
    }
    function cm(t, e) {
      if (typeof e == "function") return t = t(), e(t), function() {
        e(null);
      };
      if (e != null) return t = t(), e.current = t, function() {
        e.current = null;
      };
    }
    function hm(t, e, r) {
      return r = r != null ? r.concat([t]) : null, sl(4, 4, cm.bind(null, e, t), r);
    }
    function uh() {
    }
    function pm(t, e) {
      var r = Kt();
      e = e === void 0 ? null : e;
      var n = r.memoizedState;
      return n !== null && e !== null && sh(e, n[1]) ? n[0] : (r.memoizedState = [t, e], t);
    }
    function fm(t, e) {
      var r = Kt();
      e = e === void 0 ? null : e;
      var n = r.memoizedState;
      return n !== null && e !== null && sh(e, n[1]) ? n[0] : (t = t(), r.memoizedState = [t, e], t);
    }
    function dm(t, e, r) {
      return ($n & 21) === 0 ? (t.baseState && (t.baseState = false, kt = true), t.memoizedState = r) : (pr(r, e) || (r = yd(), Ce.lanes |= r, Yn |= r, t.baseState = true), e);
    }
    function Nw(t, e) {
      var r = fe;
      fe = r !== 0 && 4 > r ? r : 4, t(true);
      var n = Ru.transition;
      Ru.transition = {};
      try {
        t(false), e();
      } finally {
        fe = r, Ru.transition = n;
      }
    }
    function mm() {
      return Kt().memoizedState;
    }
    function Ow(t, e, r) {
      var n = wn(t);
      if (r = { lane: n, action: r, hasEagerState: false, eagerState: null, next: null }, gm(t)) _m(e, r);
      else if (r = Zd(t, e, r, n), r !== null) {
        var o = mt();
        hr(r, t, n, o), xm(r, e, n);
      }
    }
    function Ew(t, e, r) {
      var n = wn(t), o = { lane: n, action: r, hasEagerState: false, eagerState: null, next: null };
      if (gm(t)) _m(e, o);
      else {
        var s = t.alternate;
        if (t.lanes === 0 && (s === null || s.lanes === 0) && (s = e.lastRenderedReducer, s !== null)) try {
          var i = e.lastRenderedState, a = s(i, r);
          if (o.hasEagerState = true, o.eagerState = a, pr(a, i)) {
            var l = e.interleaved;
            l === null ? (o.next = o, eh(e)) : (o.next = l.next, l.next = o), e.interleaved = o;
            return;
          }
        } catch {
        } finally {
        }
        r = Zd(t, e, o, n), r !== null && (o = mt(), hr(r, t, n, o), xm(r, e, n));
      }
    }
    function gm(t) {
      var e = t.alternate;
      return t === Ce || e !== null && e === Ce;
    }
    function _m(t, e) {
      Hs = Qa = true;
      var r = t.pending;
      r === null ? e.next = e : (e.next = r.next, r.next = e), t.pending = e;
    }
    function xm(t, e, r) {
      if ((r & 4194240) !== 0) {
        var n = e.lanes;
        n &= t.pendingLanes, r |= n, e.lanes = r, jc(t, r);
      }
    }
    var Ha = { readContext: Zt, useCallback: it, useContext: it, useEffect: it, useImperativeHandle: it, useInsertionEffect: it, useLayoutEffect: it, useMemo: it, useReducer: it, useRef: it, useState: it, useDebugValue: it, useDeferredValue: it, useTransition: it, useMutableSource: it, useSyncExternalStore: it, useId: it, unstable_isNewReconciler: false }, bw = { readContext: Zt, useCallback: function(t, e) {
      return kr().memoizedState = [t, e === void 0 ? null : e], t;
    }, useContext: Zt, useEffect: Ef, useImperativeHandle: function(t, e, r) {
      return r = r != null ? r.concat([t]) : null, Aa(4194308, 4, cm.bind(null, e, t), r);
    }, useLayoutEffect: function(t, e) {
      return Aa(4194308, 4, t, e);
    }, useInsertionEffect: function(t, e) {
      return Aa(4, 2, t, e);
    }, useMemo: function(t, e) {
      var r = kr();
      return e = e === void 0 ? null : e, t = t(), r.memoizedState = [t, e], t;
    }, useReducer: function(t, e, r) {
      var n = kr();
      return e = r !== void 0 ? r(e) : e, n.memoizedState = n.baseState = e, t = { pending: null, interleaved: null, lanes: 0, dispatch: null, lastRenderedReducer: t, lastRenderedState: e }, n.queue = t, t = t.dispatch = Ow.bind(null, Ce, t), [n.memoizedState, t];
    }, useRef: function(t) {
      var e = kr();
      return t = { current: t }, e.memoizedState = t;
    }, useState: Of, useDebugValue: uh, useDeferredValue: function(t) {
      return kr().memoizedState = t;
    }, useTransition: function() {
      var t = Of(false), e = t[0];
      return t = Nw.bind(null, t[1]), kr().memoizedState = t, [e, t];
    }, useMutableSource: function() {
    }, useSyncExternalStore: function(t, e, r) {
      var n = Ce, o = kr();
      if (Se) {
        if (r === void 0) throw Error(P(407));
        r = r();
      } else {
        if (r = e(), Ze === null) throw Error(P(349));
        ($n & 30) !== 0 || rm(n, e, r);
      }
      o.memoizedState = r;
      var s = { value: r, getSnapshot: e };
      return o.queue = s, Ef(om.bind(null, n, s, t), [t]), n.flags |= 2048, pi(9, nm.bind(null, n, s, r, e), void 0, null), r;
    }, useId: function() {
      var t = kr(), e = Ze.identifierPrefix;
      if (Se) {
        var r = Wr, n = zr;
        r = (n & ~(1 << 32 - cr(n) - 1)).toString(32) + r, e = ":" + e + "R" + r, r = ci++, 0 < r && (e += "H" + r.toString(32)), e += ":";
      } else r = Cw++, e = ":" + e + "r" + r.toString(32) + ":";
      return t.memoizedState = e;
    }, unstable_isNewReconciler: false }, Dw = { readContext: Zt, useCallback: pm, useContext: Zt, useEffect: lh, useImperativeHandle: hm, useInsertionEffect: lm, useLayoutEffect: um, useMemo: fm, useReducer: Fu, useRef: am, useState: function() {
      return Fu(hi);
    }, useDebugValue: uh, useDeferredValue: function(t) {
      var e = Kt();
      return dm(e, Ge.memoizedState, t);
    }, useTransition: function() {
      var t = Fu(hi)[0], e = Kt().memoizedState;
      return [t, e];
    }, useMutableSource: em, useSyncExternalStore: tm, useId: mm, unstable_isNewReconciler: false }, Mw = { readContext: Zt, useCallback: pm, useContext: Zt, useEffect: lh, useImperativeHandle: hm, useInsertionEffect: lm, useLayoutEffect: um, useMemo: fm, useReducer: Iu, useRef: am, useState: function() {
      return Iu(hi);
    }, useDebugValue: uh, useDeferredValue: function(t) {
      var e = Kt();
      return Ge === null ? e.memoizedState = t : dm(e, Ge.memoizedState, t);
    }, useTransition: function() {
      var t = Iu(hi)[0], e = Kt().memoizedState;
      return [t, e];
    }, useMutableSource: em, useSyncExternalStore: tm, useId: mm, unstable_isNewReconciler: false };
    function ar(t, e) {
      if (t && t.defaultProps) {
        e = Ne({}, e), t = t.defaultProps;
        for (var r in t) e[r] === void 0 && (e[r] = t[r]);
        return e;
      }
      return e;
    }
    function gc(t, e, r, n) {
      e = t.memoizedState, r = r(n, e), r = r == null ? e : Ne({}, e, r), t.memoizedState = r, t.lanes === 0 && (t.updateQueue.baseState = r);
    }
    var il = { isMounted: function(t) {
      return (t = t._reactInternals) ? Kn(t) === t : false;
    }, enqueueSetState: function(t, e, r) {
      t = t._reactInternals;
      var n = mt(), o = wn(t), s = Br(n, o);
      s.payload = e, r != null && (s.callback = r), e = yn(t, s, o), e !== null && (hr(e, t, o, n), Sa(e, t, o));
    }, enqueueReplaceState: function(t, e, r) {
      t = t._reactInternals;
      var n = mt(), o = wn(t), s = Br(n, o);
      s.tag = 1, s.payload = e, r != null && (s.callback = r), e = yn(t, s, o), e !== null && (hr(e, t, o, n), Sa(e, t, o));
    }, enqueueForceUpdate: function(t, e) {
      t = t._reactInternals;
      var r = mt(), n = wn(t), o = Br(r, n);
      o.tag = 2, e != null && (o.callback = e), e = yn(t, o, n), e !== null && (hr(e, t, n, r), Sa(e, t, n));
    } };
    function bf(t, e, r, n, o, s, i) {
      return t = t.stateNode, typeof t.shouldComponentUpdate == "function" ? t.shouldComponentUpdate(n, s, i) : e.prototype && e.prototype.isPureReactComponent ? !oi(r, n) || !oi(o, s) : true;
    }
    function ym(t, e, r) {
      var n = false, o = An, s = e.contextType;
      return typeof s == "object" && s !== null ? s = Zt(s) : (o = Nt(e) ? Qn : ut.current, n = e.contextTypes, s = (n = n != null) ? Po(t, o) : An), e = new e(r, s), t.memoizedState = e.state !== null && e.state !== void 0 ? e.state : null, e.updater = il, t.stateNode = e, e._reactInternals = t, n && (t = t.stateNode, t.__reactInternalMemoizedUnmaskedChildContext = o, t.__reactInternalMemoizedMaskedChildContext = s), e;
    }
    function Df(t, e, r, n) {
      t = e.state, typeof e.componentWillReceiveProps == "function" && e.componentWillReceiveProps(r, n), typeof e.UNSAFE_componentWillReceiveProps == "function" && e.UNSAFE_componentWillReceiveProps(r, n), e.state !== t && il.enqueueReplaceState(e, e.state, null);
    }
    function _c(t, e, r, n) {
      var o = t.stateNode;
      o.props = r, o.state = t.memoizedState, o.refs = {}, th(t);
      var s = e.contextType;
      typeof s == "object" && s !== null ? o.context = Zt(s) : (s = Nt(e) ? Qn : ut.current, o.context = Po(t, s)), o.state = t.memoizedState, s = e.getDerivedStateFromProps, typeof s == "function" && (gc(t, e, s, r), o.state = t.memoizedState), typeof e.getDerivedStateFromProps == "function" || typeof o.getSnapshotBeforeUpdate == "function" || typeof o.UNSAFE_componentWillMount != "function" && typeof o.componentWillMount != "function" || (e = o.state, typeof o.componentWillMount == "function" && o.componentWillMount(), typeof o.UNSAFE_componentWillMount == "function" && o.UNSAFE_componentWillMount(), e !== o.state && il.enqueueReplaceState(o, o.state, null), Ua(t, r, o, n), o.state = t.memoizedState), typeof o.componentDidMount == "function" && (t.flags |= 4194308);
    }
    function jo(t, e) {
      try {
        var r = "", n = e;
        do
          r += l0(n), n = n.return;
        while (n);
        var o = r;
      } catch (s) {
        o = `
Error generating stack: ` + s.message + `
` + s.stack;
      }
      return { value: t, source: e, stack: o, digest: null };
    }
    function Pu(t, e, r) {
      return { value: t, source: null, stack: r ?? null, digest: e ?? null };
    }
    function xc(t, e) {
      try {
        console.error(e.value);
      } catch (r) {
        setTimeout(function() {
          throw r;
        });
      }
    }
    var Rw = typeof WeakMap == "function" ? WeakMap : Map;
    function vm(t, e, r) {
      r = Br(-1, r), r.tag = 3, r.payload = { element: null };
      var n = e.value;
      return r.callback = function() {
        Ya || (Ya = true, Oc = n), xc(t, e);
      }, r;
    }
    function wm(t, e, r) {
      r = Br(-1, r), r.tag = 3;
      var n = t.type.getDerivedStateFromError;
      if (typeof n == "function") {
        var o = e.value;
        r.payload = function() {
          return n(o);
        }, r.callback = function() {
          xc(t, e);
        };
      }
      var s = t.stateNode;
      return s !== null && typeof s.componentDidCatch == "function" && (r.callback = function() {
        xc(t, e), typeof n != "function" && (vn === null ? vn = /* @__PURE__ */ new Set([this]) : vn.add(this));
        var i = e.stack;
        this.componentDidCatch(e.value, { componentStack: i !== null ? i : "" });
      }), r;
    }
    function Mf(t, e, r) {
      var n = t.pingCache;
      if (n === null) {
        n = t.pingCache = new Rw();
        var o = /* @__PURE__ */ new Set();
        n.set(e, o);
      } else o = n.get(e), o === void 0 && (o = /* @__PURE__ */ new Set(), n.set(e, o));
      o.has(r) || (o.add(r), t = Hw.bind(null, t, e, r), e.then(t, t));
    }
    function Rf(t) {
      do {
        var e;
        if ((e = t.tag === 13) && (e = t.memoizedState, e = e !== null ? e.dehydrated !== null : true), e) return t;
        t = t.return;
      } while (t !== null);
      return null;
    }
    function Ff(t, e, r, n, o) {
      return (t.mode & 1) === 0 ? (t === e ? t.flags |= 65536 : (t.flags |= 128, r.flags |= 131072, r.flags &= -52805, r.tag === 1 && (r.alternate === null ? r.tag = 17 : (e = Br(-1, 1), e.tag = 2, yn(r, e, 1))), r.lanes |= 1), t) : (t.flags |= 65536, t.lanes = o, t);
    }
    var Fw = $r.ReactCurrentOwner, kt = false;
    function dt(t, e, r, n) {
      e.child = t === null ? Xd(e, null, r, n) : Lo(e, t.child, r, n);
    }
    function If(t, e, r, n, o) {
      r = r.render;
      var s = e.ref;
      return Ro(e, o), n = ih(t, e, r, n, s, o), r = ah(), t !== null && !kt ? (e.updateQueue = t.updateQueue, e.flags &= -2053, t.lanes &= ~o, Hr(t, e, o)) : (Se && r && $c(e), e.flags |= 1, dt(t, e, n, o), e.child);
    }
    function Pf(t, e, r, n, o) {
      if (t === null) {
        var s = r.type;
        return typeof s == "function" && !_h(s) && s.defaultProps === void 0 && r.compare === null && r.defaultProps === void 0 ? (e.tag = 15, e.type = s, Sm(t, e, s, n, o)) : (t = Oa(r.type, null, n, e, e.mode, o), t.ref = e.ref, t.return = e, e.child = t);
      }
      if (s = t.child, (t.lanes & o) === 0) {
        var i = s.memoizedProps;
        if (r = r.compare, r = r !== null ? r : oi, r(i, n) && t.ref === e.ref) return Hr(t, e, o);
      }
      return e.flags |= 1, t = Sn(s, n), t.ref = e.ref, t.return = e, e.child = t;
    }
    function Sm(t, e, r, n, o) {
      if (t !== null) {
        var s = t.memoizedProps;
        if (oi(s, n) && t.ref === e.ref) if (kt = false, e.pendingProps = n = s, (t.lanes & o) !== 0) (t.flags & 131072) !== 0 && (kt = true);
        else return e.lanes = t.lanes, Hr(t, e, o);
      }
      return yc(t, e, r, n, o);
    }
    function Tm(t, e, r) {
      var n = e.pendingProps, o = n.children, s = t !== null ? t.memoizedState : null;
      if (n.mode === "hidden") if ((e.mode & 1) === 0) e.memoizedState = { baseLanes: 0, cachePool: null, transitions: null }, xe(Oo, Rt), Rt |= r;
      else {
        if ((r & 1073741824) === 0) return t = s !== null ? s.baseLanes | r : r, e.lanes = e.childLanes = 1073741824, e.memoizedState = { baseLanes: t, cachePool: null, transitions: null }, e.updateQueue = null, xe(Oo, Rt), Rt |= t, null;
        e.memoizedState = { baseLanes: 0, cachePool: null, transitions: null }, n = s !== null ? s.baseLanes : r, xe(Oo, Rt), Rt |= n;
      }
      else s !== null ? (n = s.baseLanes | r, e.memoizedState = null) : n = r, xe(Oo, Rt), Rt |= n;
      return dt(t, e, o, r), e.child;
    }
    function Am(t, e) {
      var r = e.ref;
      (t === null && r !== null || t !== null && t.ref !== r) && (e.flags |= 512, e.flags |= 2097152);
    }
    function yc(t, e, r, n, o) {
      var s = Nt(r) ? Qn : ut.current;
      return s = Po(e, s), Ro(e, o), r = ih(t, e, r, n, s, o), n = ah(), t !== null && !kt ? (e.updateQueue = t.updateQueue, e.flags &= -2053, t.lanes &= ~o, Hr(t, e, o)) : (Se && n && $c(e), e.flags |= 1, dt(t, e, r, o), e.child);
    }
    function Vf(t, e, r, n, o) {
      if (Nt(r)) {
        var s = true;
        qa(e);
      } else s = false;
      if (Ro(e, o), e.stateNode === null) ka(t, e), ym(e, r, n), _c(e, r, n, o), n = true;
      else if (t === null) {
        var i = e.stateNode, a = e.memoizedProps;
        i.props = a;
        var l = i.context, u = r.contextType;
        typeof u == "object" && u !== null ? u = Zt(u) : (u = Nt(r) ? Qn : ut.current, u = Po(e, u));
        var c = r.getDerivedStateFromProps, h = typeof c == "function" || typeof i.getSnapshotBeforeUpdate == "function";
        h || typeof i.UNSAFE_componentWillReceiveProps != "function" && typeof i.componentWillReceiveProps != "function" || (a !== n || l !== u) && Df(e, i, n, u), cn = false;
        var p = e.memoizedState;
        i.state = p, Ua(e, n, i, o), l = e.memoizedState, a !== n || p !== l || Ct.current || cn ? (typeof c == "function" && (gc(e, r, c, n), l = e.memoizedState), (a = cn || bf(e, r, a, n, p, l, u)) ? (h || typeof i.UNSAFE_componentWillMount != "function" && typeof i.componentWillMount != "function" || (typeof i.componentWillMount == "function" && i.componentWillMount(), typeof i.UNSAFE_componentWillMount == "function" && i.UNSAFE_componentWillMount()), typeof i.componentDidMount == "function" && (e.flags |= 4194308)) : (typeof i.componentDidMount == "function" && (e.flags |= 4194308), e.memoizedProps = n, e.memoizedState = l), i.props = n, i.state = l, i.context = u, n = a) : (typeof i.componentDidMount == "function" && (e.flags |= 4194308), n = false);
      } else {
        i = e.stateNode, Kd(t, e), a = e.memoizedProps, u = e.type === e.elementType ? a : ar(e.type, a), i.props = u, h = e.pendingProps, p = i.context, l = r.contextType, typeof l == "object" && l !== null ? l = Zt(l) : (l = Nt(r) ? Qn : ut.current, l = Po(e, l));
        var d = r.getDerivedStateFromProps;
        (c = typeof d == "function" || typeof i.getSnapshotBeforeUpdate == "function") || typeof i.UNSAFE_componentWillReceiveProps != "function" && typeof i.componentWillReceiveProps != "function" || (a !== h || p !== l) && Df(e, i, n, l), cn = false, p = e.memoizedState, i.state = p, Ua(e, n, i, o);
        var m = e.memoizedState;
        a !== h || p !== m || Ct.current || cn ? (typeof d == "function" && (gc(e, r, d, n), m = e.memoizedState), (u = cn || bf(e, r, u, n, p, m, l) || false) ? (c || typeof i.UNSAFE_componentWillUpdate != "function" && typeof i.componentWillUpdate != "function" || (typeof i.componentWillUpdate == "function" && i.componentWillUpdate(n, m, l), typeof i.UNSAFE_componentWillUpdate == "function" && i.UNSAFE_componentWillUpdate(n, m, l)), typeof i.componentDidUpdate == "function" && (e.flags |= 4), typeof i.getSnapshotBeforeUpdate == "function" && (e.flags |= 1024)) : (typeof i.componentDidUpdate != "function" || a === t.memoizedProps && p === t.memoizedState || (e.flags |= 4), typeof i.getSnapshotBeforeUpdate != "function" || a === t.memoizedProps && p === t.memoizedState || (e.flags |= 1024), e.memoizedProps = n, e.memoizedState = m), i.props = n, i.state = m, i.context = l, n = u) : (typeof i.componentDidUpdate != "function" || a === t.memoizedProps && p === t.memoizedState || (e.flags |= 4), typeof i.getSnapshotBeforeUpdate != "function" || a === t.memoizedProps && p === t.memoizedState || (e.flags |= 1024), n = false);
      }
      return vc(t, e, r, n, s, o);
    }
    function vc(t, e, r, n, o, s) {
      Am(t, e);
      var i = (e.flags & 128) !== 0;
      if (!n && !i) return o && Sf(e, r, false), Hr(t, e, s);
      n = e.stateNode, Fw.current = e;
      var a = i && typeof r.getDerivedStateFromError != "function" ? null : n.render();
      return e.flags |= 1, t !== null && i ? (e.child = Lo(e, t.child, null, s), e.child = Lo(e, null, a, s)) : dt(t, e, a, s), e.memoizedState = n.state, o && Sf(e, r, true), e.child;
    }
    function km(t) {
      var e = t.stateNode;
      e.pendingContext ? wf(t, e.pendingContext, e.pendingContext !== e.context) : e.context && wf(t, e.context, false), rh(t, e.containerInfo);
    }
    function Lf(t, e, r, n, o) {
      return Vo(), Xc(o), e.flags |= 256, dt(t, e, r, n), e.child;
    }
    var wc = { dehydrated: null, treeContext: null, retryLane: 0 };
    function Sc(t) {
      return { baseLanes: t, cachePool: null, transitions: null };
    }
    function Cm(t, e, r) {
      var n = e.pendingProps, o = ke.current, s = false, i = (e.flags & 128) !== 0, a;
      if ((a = i) || (a = t !== null && t.memoizedState === null ? false : (o & 2) !== 0), a ? (s = true, e.flags &= -129) : (t === null || t.memoizedState !== null) && (o |= 1), xe(ke, o & 1), t === null) return dc(e), t = e.memoizedState, t !== null && (t = t.dehydrated, t !== null) ? ((e.mode & 1) === 0 ? e.lanes = 1 : t.data === "$!" ? e.lanes = 8 : e.lanes = 1073741824, null) : (i = n.children, t = n.fallback, s ? (n = e.mode, s = e.child, i = { mode: "hidden", children: i }, (n & 1) === 0 && s !== null ? (s.childLanes = 0, s.pendingProps = i) : s = ul(i, n, 0, null), t = Gn(t, n, r, null), s.return = e, t.return = e, s.sibling = t, e.child = s, e.child.memoizedState = Sc(r), e.memoizedState = wc, t) : ch(e, i));
      if (o = t.memoizedState, o !== null && (a = o.dehydrated, a !== null)) return Iw(t, e, i, n, a, o, r);
      if (s) {
        s = n.fallback, i = e.mode, o = t.child, a = o.sibling;
        var l = { mode: "hidden", children: n.children };
        return (i & 1) === 0 && e.child !== o ? (n = e.child, n.childLanes = 0, n.pendingProps = l, e.deletions = null) : (n = Sn(o, l), n.subtreeFlags = o.subtreeFlags & 14680064), a !== null ? s = Sn(a, s) : (s = Gn(s, i, r, null), s.flags |= 2), s.return = e, n.return = e, n.sibling = s, e.child = n, n = s, s = e.child, i = t.child.memoizedState, i = i === null ? Sc(r) : { baseLanes: i.baseLanes | r, cachePool: null, transitions: i.transitions }, s.memoizedState = i, s.childLanes = t.childLanes & ~r, e.memoizedState = wc, n;
      }
      return s = t.child, t = s.sibling, n = Sn(s, { mode: "visible", children: n.children }), (e.mode & 1) === 0 && (n.lanes = r), n.return = e, n.sibling = null, t !== null && (r = e.deletions, r === null ? (e.deletions = [t], e.flags |= 16) : r.push(t)), e.child = n, e.memoizedState = null, n;
    }
    function ch(t, e) {
      return e = ul({ mode: "visible", children: e }, t.mode, 0, null), e.return = t, t.child = e;
    }
    function ga(t, e, r, n) {
      return n !== null && Xc(n), Lo(e, t.child, null, r), t = ch(e, e.pendingProps.children), t.flags |= 2, e.memoizedState = null, t;
    }
    function Iw(t, e, r, n, o, s, i) {
      if (r) return e.flags & 256 ? (e.flags &= -257, n = Pu(Error(P(422))), ga(t, e, i, n)) : e.memoizedState !== null ? (e.child = t.child, e.flags |= 128, null) : (s = n.fallback, o = e.mode, n = ul({ mode: "visible", children: n.children }, o, 0, null), s = Gn(s, o, i, null), s.flags |= 2, n.return = e, s.return = e, n.sibling = s, e.child = n, (e.mode & 1) !== 0 && Lo(e, t.child, null, i), e.child.memoizedState = Sc(i), e.memoizedState = wc, s);
      if ((e.mode & 1) === 0) return ga(t, e, i, null);
      if (o.data === "$!") {
        if (n = o.nextSibling && o.nextSibling.dataset, n) var a = n.dgst;
        return n = a, s = Error(P(419)), n = Pu(s, n, void 0), ga(t, e, i, n);
      }
      if (a = (i & t.childLanes) !== 0, kt || a) {
        if (n = Ze, n !== null) {
          switch (i & -i) {
            case 4:
              o = 2;
              break;
            case 16:
              o = 8;
              break;
            case 64:
            case 128:
            case 256:
            case 512:
            case 1024:
            case 2048:
            case 4096:
            case 8192:
            case 16384:
            case 32768:
            case 65536:
            case 131072:
            case 262144:
            case 524288:
            case 1048576:
            case 2097152:
            case 4194304:
            case 8388608:
            case 16777216:
            case 33554432:
            case 67108864:
              o = 32;
              break;
            case 536870912:
              o = 268435456;
              break;
            default:
              o = 0;
          }
          o = (o & (n.suspendedLanes | i)) !== 0 ? 0 : o, o !== 0 && o !== s.retryLane && (s.retryLane = o, Qr(t, o), hr(n, t, o, -1));
        }
        return gh(), n = Pu(Error(P(421))), ga(t, e, i, n);
      }
      return o.data === "$?" ? (e.flags |= 128, e.child = t.child, e = $w.bind(null, t), o._reactRetry = e, null) : (t = s.treeContext, Ft = xn(o.nextSibling), It = e, Se = true, ur = null, t !== null && (Ht[$t++] = zr, Ht[$t++] = Wr, Ht[$t++] = Hn, zr = t.id, Wr = t.overflow, Hn = e), e = ch(e, n.children), e.flags |= 4096, e);
    }
    function qf(t, e, r) {
      t.lanes |= e;
      var n = t.alternate;
      n !== null && (n.lanes |= e), mc(t.return, e, r);
    }
    function Vu(t, e, r, n, o) {
      var s = t.memoizedState;
      s === null ? t.memoizedState = { isBackwards: e, rendering: null, renderingStartTime: 0, last: n, tail: r, tailMode: o } : (s.isBackwards = e, s.rendering = null, s.renderingStartTime = 0, s.last = n, s.tail = r, s.tailMode = o);
    }
    function Nm(t, e, r) {
      var n = e.pendingProps, o = n.revealOrder, s = n.tail;
      if (dt(t, e, n.children, r), n = ke.current, (n & 2) !== 0) n = n & 1 | 2, e.flags |= 128;
      else {
        if (t !== null && (t.flags & 128) !== 0) e: for (t = e.child; t !== null; ) {
          if (t.tag === 13) t.memoizedState !== null && qf(t, r, e);
          else if (t.tag === 19) qf(t, r, e);
          else if (t.child !== null) {
            t.child.return = t, t = t.child;
            continue;
          }
          if (t === e) break e;
          for (; t.sibling === null; ) {
            if (t.return === null || t.return === e) break e;
            t = t.return;
          }
          t.sibling.return = t.return, t = t.sibling;
        }
        n &= 1;
      }
      if (xe(ke, n), (e.mode & 1) === 0) e.memoizedState = null;
      else switch (o) {
        case "forwards":
          for (r = e.child, o = null; r !== null; ) t = r.alternate, t !== null && Ga(t) === null && (o = r), r = r.sibling;
          r = o, r === null ? (o = e.child, e.child = null) : (o = r.sibling, r.sibling = null), Vu(e, false, o, r, s);
          break;
        case "backwards":
          for (r = null, o = e.child, e.child = null; o !== null; ) {
            if (t = o.alternate, t !== null && Ga(t) === null) {
              e.child = o;
              break;
            }
            t = o.sibling, o.sibling = r, r = o, o = t;
          }
          Vu(e, true, r, null, s);
          break;
        case "together":
          Vu(e, false, null, null, void 0);
          break;
        default:
          e.memoizedState = null;
      }
      return e.child;
    }
    function ka(t, e) {
      (e.mode & 1) === 0 && t !== null && (t.alternate = null, e.alternate = null, e.flags |= 2);
    }
    function Hr(t, e, r) {
      if (t !== null && (e.dependencies = t.dependencies), Yn |= e.lanes, (r & e.childLanes) === 0) return null;
      if (t !== null && e.child !== t.child) throw Error(P(153));
      if (e.child !== null) {
        for (t = e.child, r = Sn(t, t.pendingProps), e.child = r, r.return = e; t.sibling !== null; ) t = t.sibling, r = r.sibling = Sn(t, t.pendingProps), r.return = e;
        r.sibling = null;
      }
      return e.child;
    }
    function Pw(t, e, r) {
      switch (e.tag) {
        case 3:
          km(e), Vo();
          break;
        case 5:
          Jd(e);
          break;
        case 1:
          Nt(e.type) && qa(e);
          break;
        case 4:
          rh(e, e.stateNode.containerInfo);
          break;
        case 10:
          var n = e.type._context, o = e.memoizedProps.value;
          xe(Wa, n._currentValue), n._currentValue = o;
          break;
        case 13:
          if (n = e.memoizedState, n !== null) return n.dehydrated !== null ? (xe(ke, ke.current & 1), e.flags |= 128, null) : (r & e.child.childLanes) !== 0 ? Cm(t, e, r) : (xe(ke, ke.current & 1), t = Hr(t, e, r), t !== null ? t.sibling : null);
          xe(ke, ke.current & 1);
          break;
        case 19:
          if (n = (r & e.childLanes) !== 0, (t.flags & 128) !== 0) {
            if (n) return Nm(t, e, r);
            e.flags |= 128;
          }
          if (o = e.memoizedState, o !== null && (o.rendering = null, o.tail = null, o.lastEffect = null), xe(ke, ke.current), n) break;
          return null;
        case 22:
        case 23:
          return e.lanes = 0, Tm(t, e, r);
      }
      return Hr(t, e, r);
    }
    var Om, Tc, Em, bm;
    Om = function(t, e) {
      for (var r = e.child; r !== null; ) {
        if (r.tag === 5 || r.tag === 6) t.appendChild(r.stateNode);
        else if (r.tag !== 4 && r.child !== null) {
          r.child.return = r, r = r.child;
          continue;
        }
        if (r === e) break;
        for (; r.sibling === null; ) {
          if (r.return === null || r.return === e) return;
          r = r.return;
        }
        r.sibling.return = r.return, r = r.sibling;
      }
    };
    Tc = function() {
    };
    Em = function(t, e, r, n) {
      var o = t.memoizedProps;
      if (o !== n) {
        t = e.stateNode, Bn(Or.current);
        var s = null;
        switch (r) {
          case "input":
            o = Gu(t, o), n = Gu(t, n), s = [];
            break;
          case "select":
            o = Ne({}, o, { value: void 0 }), n = Ne({}, n, { value: void 0 }), s = [];
            break;
          case "textarea":
            o = $u(t, o), n = $u(t, n), s = [];
            break;
          default:
            typeof o.onClick != "function" && typeof n.onClick == "function" && (t.onclick = Va);
        }
        Xu(r, n);
        var i;
        r = null;
        for (u in o) if (!n.hasOwnProperty(u) && o.hasOwnProperty(u) && o[u] != null) if (u === "style") {
          var a = o[u];
          for (i in a) a.hasOwnProperty(i) && (r || (r = {}), r[i] = "");
        } else u !== "dangerouslySetInnerHTML" && u !== "children" && u !== "suppressContentEditableWarning" && u !== "suppressHydrationWarning" && u !== "autoFocus" && (Zs.hasOwnProperty(u) ? s || (s = []) : (s = s || []).push(u, null));
        for (u in n) {
          var l = n[u];
          if (a = o?.[u], n.hasOwnProperty(u) && l !== a && (l != null || a != null)) if (u === "style") if (a) {
            for (i in a) !a.hasOwnProperty(i) || l && l.hasOwnProperty(i) || (r || (r = {}), r[i] = "");
            for (i in l) l.hasOwnProperty(i) && a[i] !== l[i] && (r || (r = {}), r[i] = l[i]);
          } else r || (s || (s = []), s.push(u, r)), r = l;
          else u === "dangerouslySetInnerHTML" ? (l = l ? l.__html : void 0, a = a ? a.__html : void 0, l != null && a !== l && (s = s || []).push(u, l)) : u === "children" ? typeof l != "string" && typeof l != "number" || (s = s || []).push(u, "" + l) : u !== "suppressContentEditableWarning" && u !== "suppressHydrationWarning" && (Zs.hasOwnProperty(u) ? (l != null && u === "onScroll" && ve("scroll", t), s || a === l || (s = [])) : (s = s || []).push(u, l));
        }
        r && (s = s || []).push("style", r);
        var u = s;
        (e.updateQueue = u) && (e.flags |= 4);
      }
    };
    bm = function(t, e, r, n) {
      r !== n && (e.flags |= 4);
    };
    function Is(t, e) {
      if (!Se) switch (t.tailMode) {
        case "hidden":
          e = t.tail;
          for (var r = null; e !== null; ) e.alternate !== null && (r = e), e = e.sibling;
          r === null ? t.tail = null : r.sibling = null;
          break;
        case "collapsed":
          r = t.tail;
          for (var n = null; r !== null; ) r.alternate !== null && (n = r), r = r.sibling;
          n === null ? e || t.tail === null ? t.tail = null : t.tail.sibling = null : n.sibling = null;
      }
    }
    function at(t) {
      var e = t.alternate !== null && t.alternate.child === t.child, r = 0, n = 0;
      if (e) for (var o = t.child; o !== null; ) r |= o.lanes | o.childLanes, n |= o.subtreeFlags & 14680064, n |= o.flags & 14680064, o.return = t, o = o.sibling;
      else for (o = t.child; o !== null; ) r |= o.lanes | o.childLanes, n |= o.subtreeFlags, n |= o.flags, o.return = t, o = o.sibling;
      return t.subtreeFlags |= n, t.childLanes = r, e;
    }
    function Vw(t, e, r) {
      var n = e.pendingProps;
      switch (Yc(e), e.tag) {
        case 2:
        case 16:
        case 15:
        case 0:
        case 11:
        case 7:
        case 8:
        case 12:
        case 9:
        case 14:
          return at(e), null;
        case 1:
          return Nt(e.type) && La(), at(e), null;
        case 3:
          return n = e.stateNode, qo(), we(Ct), we(ut), oh(), n.pendingContext && (n.context = n.pendingContext, n.pendingContext = null), (t === null || t.child === null) && (da(e) ? e.flags |= 4 : t === null || t.memoizedState.isDehydrated && (e.flags & 256) === 0 || (e.flags |= 1024, ur !== null && (Dc(ur), ur = null))), Tc(t, e), at(e), null;
        case 5:
          nh(e);
          var o = Bn(ui.current);
          if (r = e.type, t !== null && e.stateNode != null) Em(t, e, r, n, o), t.ref !== e.ref && (e.flags |= 512, e.flags |= 2097152);
          else {
            if (!n) {
              if (e.stateNode === null) throw Error(P(166));
              return at(e), null;
            }
            if (t = Bn(Or.current), da(e)) {
              n = e.stateNode, r = e.type;
              var s = e.memoizedProps;
              switch (n[Cr] = e, n[ai] = s, t = (e.mode & 1) !== 0, r) {
                case "dialog":
                  ve("cancel", n), ve("close", n);
                  break;
                case "iframe":
                case "object":
                case "embed":
                  ve("load", n);
                  break;
                case "video":
                case "audio":
                  for (o = 0; o < zs.length; o++) ve(zs[o], n);
                  break;
                case "source":
                  ve("error", n);
                  break;
                case "img":
                case "image":
                case "link":
                  ve("error", n), ve("load", n);
                  break;
                case "details":
                  ve("toggle", n);
                  break;
                case "input":
                  Qp(n, s), ve("invalid", n);
                  break;
                case "select":
                  n._wrapperState = { wasMultiple: !!s.multiple }, ve("invalid", n);
                  break;
                case "textarea":
                  $p(n, s), ve("invalid", n);
              }
              Xu(r, s), o = null;
              for (var i in s) if (s.hasOwnProperty(i)) {
                var a = s[i];
                i === "children" ? typeof a == "string" ? n.textContent !== a && (s.suppressHydrationWarning !== true && fa(n.textContent, a, t), o = ["children", a]) : typeof a == "number" && n.textContent !== "" + a && (s.suppressHydrationWarning !== true && fa(n.textContent, a, t), o = ["children", "" + a]) : Zs.hasOwnProperty(i) && a != null && i === "onScroll" && ve("scroll", n);
              }
              switch (r) {
                case "input":
                  ta(n), Hp(n, s, true);
                  break;
                case "textarea":
                  ta(n), Yp(n);
                  break;
                case "select":
                case "option":
                  break;
                default:
                  typeof s.onClick == "function" && (n.onclick = Va);
              }
              n = o, e.updateQueue = n, n !== null && (e.flags |= 4);
            } else {
              i = o.nodeType === 9 ? o : o.ownerDocument, t === "http://www.w3.org/1999/xhtml" && (t = od(r)), t === "http://www.w3.org/1999/xhtml" ? r === "script" ? (t = i.createElement("div"), t.innerHTML = "<script><\/script>", t = t.removeChild(t.firstChild)) : typeof n.is == "string" ? t = i.createElement(r, { is: n.is }) : (t = i.createElement(r), r === "select" && (i = t, n.multiple ? i.multiple = true : n.size && (i.size = n.size))) : t = i.createElementNS(t, r), t[Cr] = e, t[ai] = n, Om(t, e, false, false), e.stateNode = t;
              e: {
                switch (i = Zu(r, n), r) {
                  case "dialog":
                    ve("cancel", t), ve("close", t), o = n;
                    break;
                  case "iframe":
                  case "object":
                  case "embed":
                    ve("load", t), o = n;
                    break;
                  case "video":
                  case "audio":
                    for (o = 0; o < zs.length; o++) ve(zs[o], t);
                    o = n;
                    break;
                  case "source":
                    ve("error", t), o = n;
                    break;
                  case "img":
                  case "image":
                  case "link":
                    ve("error", t), ve("load", t), o = n;
                    break;
                  case "details":
                    ve("toggle", t), o = n;
                    break;
                  case "input":
                    Qp(t, n), o = Gu(t, n), ve("invalid", t);
                    break;
                  case "option":
                    o = n;
                    break;
                  case "select":
                    t._wrapperState = { wasMultiple: !!n.multiple }, o = Ne({}, n, { value: void 0 }), ve("invalid", t);
                    break;
                  case "textarea":
                    $p(t, n), o = $u(t, n), ve("invalid", t);
                    break;
                  default:
                    o = n;
                }
                Xu(r, o), a = o;
                for (s in a) if (a.hasOwnProperty(s)) {
                  var l = a[s];
                  s === "style" ? ad(t, l) : s === "dangerouslySetInnerHTML" ? (l = l ? l.__html : void 0, l != null && sd(t, l)) : s === "children" ? typeof l == "string" ? (r !== "textarea" || l !== "") && Ks(t, l) : typeof l == "number" && Ks(t, "" + l) : s !== "suppressContentEditableWarning" && s !== "suppressHydrationWarning" && s !== "autoFocus" && (Zs.hasOwnProperty(s) ? l != null && s === "onScroll" && ve("scroll", t) : l != null && Fc(t, s, l, i));
                }
                switch (r) {
                  case "input":
                    ta(t), Hp(t, n, false);
                    break;
                  case "textarea":
                    ta(t), Yp(t);
                    break;
                  case "option":
                    n.value != null && t.setAttribute("value", "" + Tn(n.value));
                    break;
                  case "select":
                    t.multiple = !!n.multiple, s = n.value, s != null ? Eo(t, !!n.multiple, s, false) : n.defaultValue != null && Eo(t, !!n.multiple, n.defaultValue, true);
                    break;
                  default:
                    typeof o.onClick == "function" && (t.onclick = Va);
                }
                switch (r) {
                  case "button":
                  case "input":
                  case "select":
                  case "textarea":
                    n = !!n.autoFocus;
                    break e;
                  case "img":
                    n = true;
                    break e;
                  default:
                    n = false;
                }
              }
              n && (e.flags |= 4);
            }
            e.ref !== null && (e.flags |= 512, e.flags |= 2097152);
          }
          return at(e), null;
        case 6:
          if (t && e.stateNode != null) bm(t, e, t.memoizedProps, n);
          else {
            if (typeof n != "string" && e.stateNode === null) throw Error(P(166));
            if (r = Bn(ui.current), Bn(Or.current), da(e)) {
              if (n = e.stateNode, r = e.memoizedProps, n[Cr] = e, (s = n.nodeValue !== r) && (t = It, t !== null)) switch (t.tag) {
                case 3:
                  fa(n.nodeValue, r, (t.mode & 1) !== 0);
                  break;
                case 5:
                  t.memoizedProps.suppressHydrationWarning !== true && fa(n.nodeValue, r, (t.mode & 1) !== 0);
              }
              s && (e.flags |= 4);
            } else n = (r.nodeType === 9 ? r : r.ownerDocument).createTextNode(n), n[Cr] = e, e.stateNode = n;
          }
          return at(e), null;
        case 13:
          if (we(ke), n = e.memoizedState, t === null || t.memoizedState !== null && t.memoizedState.dehydrated !== null) {
            if (Se && Ft !== null && (e.mode & 1) !== 0 && (e.flags & 128) === 0) $d(), Vo(), e.flags |= 98560, s = false;
            else if (s = da(e), n !== null && n.dehydrated !== null) {
              if (t === null) {
                if (!s) throw Error(P(318));
                if (s = e.memoizedState, s = s !== null ? s.dehydrated : null, !s) throw Error(P(317));
                s[Cr] = e;
              } else Vo(), (e.flags & 128) === 0 && (e.memoizedState = null), e.flags |= 4;
              at(e), s = false;
            } else ur !== null && (Dc(ur), ur = null), s = true;
            if (!s) return e.flags & 65536 ? e : null;
          }
          return (e.flags & 128) !== 0 ? (e.lanes = r, e) : (n = n !== null, n !== (t !== null && t.memoizedState !== null) && n && (e.child.flags |= 8192, (e.mode & 1) !== 0 && (t === null || (ke.current & 1) !== 0 ? Qe === 0 && (Qe = 3) : gh())), e.updateQueue !== null && (e.flags |= 4), at(e), null);
        case 4:
          return qo(), Tc(t, e), t === null && si(e.stateNode.containerInfo), at(e), null;
        case 10:
          return Jc(e.type._context), at(e), null;
        case 17:
          return Nt(e.type) && La(), at(e), null;
        case 19:
          if (we(ke), s = e.memoizedState, s === null) return at(e), null;
          if (n = (e.flags & 128) !== 0, i = s.rendering, i === null) if (n) Is(s, false);
          else {
            if (Qe !== 0 || t !== null && (t.flags & 128) !== 0) for (t = e.child; t !== null; ) {
              if (i = Ga(t), i !== null) {
                for (e.flags |= 128, Is(s, false), n = i.updateQueue, n !== null && (e.updateQueue = n, e.flags |= 4), e.subtreeFlags = 0, n = r, r = e.child; r !== null; ) s = r, t = n, s.flags &= 14680066, i = s.alternate, i === null ? (s.childLanes = 0, s.lanes = t, s.child = null, s.subtreeFlags = 0, s.memoizedProps = null, s.memoizedState = null, s.updateQueue = null, s.dependencies = null, s.stateNode = null) : (s.childLanes = i.childLanes, s.lanes = i.lanes, s.child = i.child, s.subtreeFlags = 0, s.deletions = null, s.memoizedProps = i.memoizedProps, s.memoizedState = i.memoizedState, s.updateQueue = i.updateQueue, s.type = i.type, t = i.dependencies, s.dependencies = t === null ? null : { lanes: t.lanes, firstContext: t.firstContext }), r = r.sibling;
                return xe(ke, ke.current & 1 | 2), e.child;
              }
              t = t.sibling;
            }
            s.tail !== null && Me() > zo && (e.flags |= 128, n = true, Is(s, false), e.lanes = 4194304);
          }
          else {
            if (!n) if (t = Ga(i), t !== null) {
              if (e.flags |= 128, n = true, r = t.updateQueue, r !== null && (e.updateQueue = r, e.flags |= 4), Is(s, true), s.tail === null && s.tailMode === "hidden" && !i.alternate && !Se) return at(e), null;
            } else 2 * Me() - s.renderingStartTime > zo && r !== 1073741824 && (e.flags |= 128, n = true, Is(s, false), e.lanes = 4194304);
            s.isBackwards ? (i.sibling = e.child, e.child = i) : (r = s.last, r !== null ? r.sibling = i : e.child = i, s.last = i);
          }
          return s.tail !== null ? (e = s.tail, s.rendering = e, s.tail = e.sibling, s.renderingStartTime = Me(), e.sibling = null, r = ke.current, xe(ke, n ? r & 1 | 2 : r & 1), e) : (at(e), null);
        case 22:
        case 23:
          return mh(), n = e.memoizedState !== null, t !== null && t.memoizedState !== null !== n && (e.flags |= 8192), n && (e.mode & 1) !== 0 ? (Rt & 1073741824) !== 0 && (at(e), e.subtreeFlags & 6 && (e.flags |= 8192)) : at(e), null;
        case 24:
          return null;
        case 25:
          return null;
      }
      throw Error(P(156, e.tag));
    }
    function Lw(t, e) {
      switch (Yc(e), e.tag) {
        case 1:
          return Nt(e.type) && La(), t = e.flags, t & 65536 ? (e.flags = t & -65537 | 128, e) : null;
        case 3:
          return qo(), we(Ct), we(ut), oh(), t = e.flags, (t & 65536) !== 0 && (t & 128) === 0 ? (e.flags = t & -65537 | 128, e) : null;
        case 5:
          return nh(e), null;
        case 13:
          if (we(ke), t = e.memoizedState, t !== null && t.dehydrated !== null) {
            if (e.alternate === null) throw Error(P(340));
            Vo();
          }
          return t = e.flags, t & 65536 ? (e.flags = t & -65537 | 128, e) : null;
        case 19:
          return we(ke), null;
        case 4:
          return qo(), null;
        case 10:
          return Jc(e.type._context), null;
        case 22:
        case 23:
          return mh(), null;
        case 24:
          return null;
        default:
          return null;
      }
    }
    var _a = false, lt = false, qw = typeof WeakSet == "function" ? WeakSet : Set, U = null;
    function No(t, e) {
      var r = t.ref;
      if (r !== null) if (typeof r == "function") try {
        r(null);
      } catch (n) {
        be(t, e, n);
      }
      else r.current = null;
    }
    function Ac(t, e, r) {
      try {
        r();
      } catch (n) {
        be(t, e, n);
      }
    }
    var jf = false;
    function jw(t, e) {
      if (ac = Fa, t = Id(), Hc(t)) {
        if ("selectionStart" in t) var r = { start: t.selectionStart, end: t.selectionEnd };
        else e: {
          r = (r = t.ownerDocument) && r.defaultView || window;
          var n = r.getSelection && r.getSelection();
          if (n && n.rangeCount !== 0) {
            r = n.anchorNode;
            var o = n.anchorOffset, s = n.focusNode;
            n = n.focusOffset;
            try {
              r.nodeType, s.nodeType;
            } catch {
              r = null;
              break e;
            }
            var i = 0, a = -1, l = -1, u = 0, c = 0, h = t, p = null;
            t: for (; ; ) {
              for (var d; h !== r || o !== 0 && h.nodeType !== 3 || (a = i + o), h !== s || n !== 0 && h.nodeType !== 3 || (l = i + n), h.nodeType === 3 && (i += h.nodeValue.length), (d = h.firstChild) !== null; ) p = h, h = d;
              for (; ; ) {
                if (h === t) break t;
                if (p === r && ++u === o && (a = i), p === s && ++c === n && (l = i), (d = h.nextSibling) !== null) break;
                h = p, p = h.parentNode;
              }
              h = d;
            }
            r = a === -1 || l === -1 ? null : { start: a, end: l };
          } else r = null;
        }
        r = r || { start: 0, end: 0 };
      } else r = null;
      for (lc = { focusedElem: t, selectionRange: r }, Fa = false, U = e; U !== null; ) if (e = U, t = e.child, (e.subtreeFlags & 1028) !== 0 && t !== null) t.return = e, U = t;
      else for (; U !== null; ) {
        e = U;
        try {
          var m = e.alternate;
          if ((e.flags & 1024) !== 0) switch (e.tag) {
            case 0:
            case 11:
            case 15:
              break;
            case 1:
              if (m !== null) {
                var y = m.memoizedProps, T = m.memoizedState, f = e.stateNode, g = f.getSnapshotBeforeUpdate(e.elementType === e.type ? y : ar(e.type, y), T);
                f.__reactInternalSnapshotBeforeUpdate = g;
              }
              break;
            case 3:
              var v = e.stateNode.containerInfo;
              v.nodeType === 1 ? v.textContent = "" : v.nodeType === 9 && v.documentElement && v.removeChild(v.documentElement);
              break;
            case 5:
            case 6:
            case 4:
            case 17:
              break;
            default:
              throw Error(P(163));
          }
        } catch (k) {
          be(e, e.return, k);
        }
        if (t = e.sibling, t !== null) {
          t.return = e.return, U = t;
          break;
        }
        U = e.return;
      }
      return m = jf, jf = false, m;
    }
    function $s(t, e, r) {
      var n = e.updateQueue;
      if (n = n !== null ? n.lastEffect : null, n !== null) {
        var o = n = n.next;
        do {
          if ((o.tag & t) === t) {
            var s = o.destroy;
            o.destroy = void 0, s !== void 0 && Ac(e, r, s);
          }
          o = o.next;
        } while (o !== n);
      }
    }
    function al(t, e) {
      if (e = e.updateQueue, e = e !== null ? e.lastEffect : null, e !== null) {
        var r = e = e.next;
        do {
          if ((r.tag & t) === t) {
            var n = r.create;
            r.destroy = n();
          }
          r = r.next;
        } while (r !== e);
      }
    }
    function kc(t) {
      var e = t.ref;
      if (e !== null) {
        var r = t.stateNode;
        switch (t.tag) {
          case 5:
            t = r;
            break;
          default:
            t = r;
        }
        typeof e == "function" ? e(t) : e.current = t;
      }
    }
    function Dm(t) {
      var e = t.alternate;
      e !== null && (t.alternate = null, Dm(e)), t.child = null, t.deletions = null, t.sibling = null, t.tag === 5 && (e = t.stateNode, e !== null && (delete e[Cr], delete e[ai], delete e[hc], delete e[Sw], delete e[Tw])), t.stateNode = null, t.return = null, t.dependencies = null, t.memoizedProps = null, t.memoizedState = null, t.pendingProps = null, t.stateNode = null, t.updateQueue = null;
    }
    function Mm(t) {
      return t.tag === 5 || t.tag === 3 || t.tag === 4;
    }
    function zf(t) {
      e: for (; ; ) {
        for (; t.sibling === null; ) {
          if (t.return === null || Mm(t.return)) return null;
          t = t.return;
        }
        for (t.sibling.return = t.return, t = t.sibling; t.tag !== 5 && t.tag !== 6 && t.tag !== 18; ) {
          if (t.flags & 2 || t.child === null || t.tag === 4) continue e;
          t.child.return = t, t = t.child;
        }
        if (!(t.flags & 2)) return t.stateNode;
      }
    }
    function Cc(t, e, r) {
      var n = t.tag;
      if (n === 5 || n === 6) t = t.stateNode, e ? r.nodeType === 8 ? r.parentNode.insertBefore(t, e) : r.insertBefore(t, e) : (r.nodeType === 8 ? (e = r.parentNode, e.insertBefore(t, r)) : (e = r, e.appendChild(t)), r = r._reactRootContainer, r != null || e.onclick !== null || (e.onclick = Va));
      else if (n !== 4 && (t = t.child, t !== null)) for (Cc(t, e, r), t = t.sibling; t !== null; ) Cc(t, e, r), t = t.sibling;
    }
    function Nc(t, e, r) {
      var n = t.tag;
      if (n === 5 || n === 6) t = t.stateNode, e ? r.insertBefore(t, e) : r.appendChild(t);
      else if (n !== 4 && (t = t.child, t !== null)) for (Nc(t, e, r), t = t.sibling; t !== null; ) Nc(t, e, r), t = t.sibling;
    }
    var Je = null, lr = false;
    function ln(t, e, r) {
      for (r = r.child; r !== null; ) Rm(t, e, r), r = r.sibling;
    }
    function Rm(t, e, r) {
      if (Nr && typeof Nr.onCommitFiberUnmount == "function") try {
        Nr.onCommitFiberUnmount(Ja, r);
      } catch {
      }
      switch (r.tag) {
        case 5:
          lt || No(r, e);
        case 6:
          var n = Je, o = lr;
          Je = null, ln(t, e, r), Je = n, lr = o, Je !== null && (lr ? (t = Je, r = r.stateNode, t.nodeType === 8 ? t.parentNode.removeChild(r) : t.removeChild(r)) : Je.removeChild(r.stateNode));
          break;
        case 18:
          Je !== null && (lr ? (t = Je, r = r.stateNode, t.nodeType === 8 ? bu(t.parentNode, r) : t.nodeType === 1 && bu(t, r), ri(t)) : bu(Je, r.stateNode));
          break;
        case 4:
          n = Je, o = lr, Je = r.stateNode.containerInfo, lr = true, ln(t, e, r), Je = n, lr = o;
          break;
        case 0:
        case 11:
        case 14:
        case 15:
          if (!lt && (n = r.updateQueue, n !== null && (n = n.lastEffect, n !== null))) {
            o = n = n.next;
            do {
              var s = o, i = s.destroy;
              s = s.tag, i !== void 0 && ((s & 2) !== 0 || (s & 4) !== 0) && Ac(r, e, i), o = o.next;
            } while (o !== n);
          }
          ln(t, e, r);
          break;
        case 1:
          if (!lt && (No(r, e), n = r.stateNode, typeof n.componentWillUnmount == "function")) try {
            n.props = r.memoizedProps, n.state = r.memoizedState, n.componentWillUnmount();
          } catch (a) {
            be(r, e, a);
          }
          ln(t, e, r);
          break;
        case 21:
          ln(t, e, r);
          break;
        case 22:
          r.mode & 1 ? (lt = (n = lt) || r.memoizedState !== null, ln(t, e, r), lt = n) : ln(t, e, r);
          break;
        default:
          ln(t, e, r);
      }
    }
    function Wf(t) {
      var e = t.updateQueue;
      if (e !== null) {
        t.updateQueue = null;
        var r = t.stateNode;
        r === null && (r = t.stateNode = new qw()), e.forEach(function(n) {
          var o = Yw.bind(null, t, n);
          r.has(n) || (r.add(n), n.then(o, o));
        });
      }
    }
    function ir(t, e) {
      var r = e.deletions;
      if (r !== null) for (var n = 0; n < r.length; n++) {
        var o = r[n];
        try {
          var s = t, i = e, a = i;
          e: for (; a !== null; ) {
            switch (a.tag) {
              case 5:
                Je = a.stateNode, lr = false;
                break e;
              case 3:
                Je = a.stateNode.containerInfo, lr = true;
                break e;
              case 4:
                Je = a.stateNode.containerInfo, lr = true;
                break e;
            }
            a = a.return;
          }
          if (Je === null) throw Error(P(160));
          Rm(s, i, o), Je = null, lr = false;
          var l = o.alternate;
          l !== null && (l.return = null), o.return = null;
        } catch (u) {
          be(o, e, u);
        }
      }
      if (e.subtreeFlags & 12854) for (e = e.child; e !== null; ) Fm(e, t), e = e.sibling;
    }
    function Fm(t, e) {
      var r = t.alternate, n = t.flags;
      switch (t.tag) {
        case 0:
        case 11:
        case 14:
        case 15:
          if (ir(e, t), Ar(t), n & 4) {
            try {
              $s(3, t, t.return), al(3, t);
            } catch (y) {
              be(t, t.return, y);
            }
            try {
              $s(5, t, t.return);
            } catch (y) {
              be(t, t.return, y);
            }
          }
          break;
        case 1:
          ir(e, t), Ar(t), n & 512 && r !== null && No(r, r.return);
          break;
        case 5:
          if (ir(e, t), Ar(t), n & 512 && r !== null && No(r, r.return), t.flags & 32) {
            var o = t.stateNode;
            try {
              Ks(o, "");
            } catch (y) {
              be(t, t.return, y);
            }
          }
          if (n & 4 && (o = t.stateNode, o != null)) {
            var s = t.memoizedProps, i = r !== null ? r.memoizedProps : s, a = t.type, l = t.updateQueue;
            if (t.updateQueue = null, l !== null) try {
              a === "input" && s.type === "radio" && s.name != null && rd(o, s), Zu(a, i);
              var u = Zu(a, s);
              for (i = 0; i < l.length; i += 2) {
                var c = l[i], h = l[i + 1];
                c === "style" ? ad(o, h) : c === "dangerouslySetInnerHTML" ? sd(o, h) : c === "children" ? Ks(o, h) : Fc(o, c, h, u);
              }
              switch (a) {
                case "input":
                  Qu(o, s);
                  break;
                case "textarea":
                  nd(o, s);
                  break;
                case "select":
                  var p = o._wrapperState.wasMultiple;
                  o._wrapperState.wasMultiple = !!s.multiple;
                  var d = s.value;
                  d != null ? Eo(o, !!s.multiple, d, false) : p !== !!s.multiple && (s.defaultValue != null ? Eo(o, !!s.multiple, s.defaultValue, true) : Eo(o, !!s.multiple, s.multiple ? [] : "", false));
              }
              o[ai] = s;
            } catch (y) {
              be(t, t.return, y);
            }
          }
          break;
        case 6:
          if (ir(e, t), Ar(t), n & 4) {
            if (t.stateNode === null) throw Error(P(162));
            o = t.stateNode, s = t.memoizedProps;
            try {
              o.nodeValue = s;
            } catch (y) {
              be(t, t.return, y);
            }
          }
          break;
        case 3:
          if (ir(e, t), Ar(t), n & 4 && r !== null && r.memoizedState.isDehydrated) try {
            ri(e.containerInfo);
          } catch (y) {
            be(t, t.return, y);
          }
          break;
        case 4:
          ir(e, t), Ar(t);
          break;
        case 13:
          ir(e, t), Ar(t), o = t.child, o.flags & 8192 && (s = o.memoizedState !== null, o.stateNode.isHidden = s, !s || o.alternate !== null && o.alternate.memoizedState !== null || (fh = Me())), n & 4 && Wf(t);
          break;
        case 22:
          if (c = r !== null && r.memoizedState !== null, t.mode & 1 ? (lt = (u = lt) || c, ir(e, t), lt = u) : ir(e, t), Ar(t), n & 8192) {
            if (u = t.memoizedState !== null, (t.stateNode.isHidden = u) && !c && (t.mode & 1) !== 0) for (U = t, c = t.child; c !== null; ) {
              for (h = U = c; U !== null; ) {
                switch (p = U, d = p.child, p.tag) {
                  case 0:
                  case 11:
                  case 14:
                  case 15:
                    $s(4, p, p.return);
                    break;
                  case 1:
                    No(p, p.return);
                    var m = p.stateNode;
                    if (typeof m.componentWillUnmount == "function") {
                      n = p, r = p.return;
                      try {
                        e = n, m.props = e.memoizedProps, m.state = e.memoizedState, m.componentWillUnmount();
                      } catch (y) {
                        be(n, r, y);
                      }
                    }
                    break;
                  case 5:
                    No(p, p.return);
                    break;
                  case 22:
                    if (p.memoizedState !== null) {
                      Uf(h);
                      continue;
                    }
                }
                d !== null ? (d.return = p, U = d) : Uf(h);
              }
              c = c.sibling;
            }
            e: for (c = null, h = t; ; ) {
              if (h.tag === 5) {
                if (c === null) {
                  c = h;
                  try {
                    o = h.stateNode, u ? (s = o.style, typeof s.setProperty == "function" ? s.setProperty("display", "none", "important") : s.display = "none") : (a = h.stateNode, l = h.memoizedProps.style, i = l != null && l.hasOwnProperty("display") ? l.display : null, a.style.display = id("display", i));
                  } catch (y) {
                    be(t, t.return, y);
                  }
                }
              } else if (h.tag === 6) {
                if (c === null) try {
                  h.stateNode.nodeValue = u ? "" : h.memoizedProps;
                } catch (y) {
                  be(t, t.return, y);
                }
              } else if ((h.tag !== 22 && h.tag !== 23 || h.memoizedState === null || h === t) && h.child !== null) {
                h.child.return = h, h = h.child;
                continue;
              }
              if (h === t) break e;
              for (; h.sibling === null; ) {
                if (h.return === null || h.return === t) break e;
                c === h && (c = null), h = h.return;
              }
              c === h && (c = null), h.sibling.return = h.return, h = h.sibling;
            }
          }
          break;
        case 19:
          ir(e, t), Ar(t), n & 4 && Wf(t);
          break;
        case 21:
          break;
        default:
          ir(e, t), Ar(t);
      }
    }
    function Ar(t) {
      var e = t.flags;
      if (e & 2) {
        try {
          e: {
            for (var r = t.return; r !== null; ) {
              if (Mm(r)) {
                var n = r;
                break e;
              }
              r = r.return;
            }
            throw Error(P(160));
          }
          switch (n.tag) {
            case 5:
              var o = n.stateNode;
              n.flags & 32 && (Ks(o, ""), n.flags &= -33);
              var s = zf(t);
              Nc(t, s, o);
              break;
            case 3:
            case 4:
              var i = n.stateNode.containerInfo, a = zf(t);
              Cc(t, a, i);
              break;
            default:
              throw Error(P(161));
          }
        } catch (l) {
          be(t, t.return, l);
        }
        t.flags &= -3;
      }
      e & 4096 && (t.flags &= -4097);
    }
    function zw(t, e, r) {
      U = t, Im(t, e, r);
    }
    function Im(t, e, r) {
      for (var n = (t.mode & 1) !== 0; U !== null; ) {
        var o = U, s = o.child;
        if (o.tag === 22 && n) {
          var i = o.memoizedState !== null || _a;
          if (!i) {
            var a = o.alternate, l = a !== null && a.memoizedState !== null || lt;
            a = _a;
            var u = lt;
            if (_a = i, (lt = l) && !u) for (U = o; U !== null; ) i = U, l = i.child, i.tag === 22 && i.memoizedState !== null ? Gf(o) : l !== null ? (l.return = i, U = l) : Gf(o);
            for (; s !== null; ) U = s, Im(s, e, r), s = s.sibling;
            U = o, _a = a, lt = u;
          }
          Bf(t, e, r);
        } else (o.subtreeFlags & 8772) !== 0 && s !== null ? (s.return = o, U = s) : Bf(t, e, r);
      }
    }
    function Bf(t) {
      for (; U !== null; ) {
        var e = U;
        if ((e.flags & 8772) !== 0) {
          var r = e.alternate;
          try {
            if ((e.flags & 8772) !== 0) switch (e.tag) {
              case 0:
              case 11:
              case 15:
                lt || al(5, e);
                break;
              case 1:
                var n = e.stateNode;
                if (e.flags & 4 && !lt) if (r === null) n.componentDidMount();
                else {
                  var o = e.elementType === e.type ? r.memoizedProps : ar(e.type, r.memoizedProps);
                  n.componentDidUpdate(o, r.memoizedState, n.__reactInternalSnapshotBeforeUpdate);
                }
                var s = e.updateQueue;
                s !== null && Nf(e, s, n);
                break;
              case 3:
                var i = e.updateQueue;
                if (i !== null) {
                  if (r = null, e.child !== null) switch (e.child.tag) {
                    case 5:
                      r = e.child.stateNode;
                      break;
                    case 1:
                      r = e.child.stateNode;
                  }
                  Nf(e, i, r);
                }
                break;
              case 5:
                var a = e.stateNode;
                if (r === null && e.flags & 4) {
                  r = a;
                  var l = e.memoizedProps;
                  switch (e.type) {
                    case "button":
                    case "input":
                    case "select":
                    case "textarea":
                      l.autoFocus && r.focus();
                      break;
                    case "img":
                      l.src && (r.src = l.src);
                  }
                }
                break;
              case 6:
                break;
              case 4:
                break;
              case 12:
                break;
              case 13:
                if (e.memoizedState === null) {
                  var u = e.alternate;
                  if (u !== null) {
                    var c = u.memoizedState;
                    if (c !== null) {
                      var h = c.dehydrated;
                      h !== null && ri(h);
                    }
                  }
                }
                break;
              case 19:
              case 17:
              case 21:
              case 22:
              case 23:
              case 25:
                break;
              default:
                throw Error(P(163));
            }
            lt || e.flags & 512 && kc(e);
          } catch (p) {
            be(e, e.return, p);
          }
        }
        if (e === t) {
          U = null;
          break;
        }
        if (r = e.sibling, r !== null) {
          r.return = e.return, U = r;
          break;
        }
        U = e.return;
      }
    }
    function Uf(t) {
      for (; U !== null; ) {
        var e = U;
        if (e === t) {
          U = null;
          break;
        }
        var r = e.sibling;
        if (r !== null) {
          r.return = e.return, U = r;
          break;
        }
        U = e.return;
      }
    }
    function Gf(t) {
      for (; U !== null; ) {
        var e = U;
        try {
          switch (e.tag) {
            case 0:
            case 11:
            case 15:
              var r = e.return;
              try {
                al(4, e);
              } catch (l) {
                be(e, r, l);
              }
              break;
            case 1:
              var n = e.stateNode;
              if (typeof n.componentDidMount == "function") {
                var o = e.return;
                try {
                  n.componentDidMount();
                } catch (l) {
                  be(e, o, l);
                }
              }
              var s = e.return;
              try {
                kc(e);
              } catch (l) {
                be(e, s, l);
              }
              break;
            case 5:
              var i = e.return;
              try {
                kc(e);
              } catch (l) {
                be(e, i, l);
              }
          }
        } catch (l) {
          be(e, e.return, l);
        }
        if (e === t) {
          U = null;
          break;
        }
        var a = e.sibling;
        if (a !== null) {
          a.return = e.return, U = a;
          break;
        }
        U = e.return;
      }
    }
    var Ww = Math.ceil, $a = $r.ReactCurrentDispatcher, hh = $r.ReactCurrentOwner, Xt = $r.ReactCurrentBatchConfig, se = 0, Ze = null, Le = null, et = 0, Rt = 0, Oo = Cn(0), Qe = 0, fi = null, Yn = 0, ll = 0, ph = 0, Ys = null, At = null, fh = 0, zo = 1 / 0, qr = null, Ya = false, Oc = null, vn = null, xa = false, dn = null, Xa = 0, Xs = 0, Ec = null, Ca = -1, Na = 0;
    function mt() {
      return (se & 6) !== 0 ? Me() : Ca !== -1 ? Ca : Ca = Me();
    }
    function wn(t) {
      return (t.mode & 1) === 0 ? 1 : (se & 2) !== 0 && et !== 0 ? et & -et : kw.transition !== null ? (Na === 0 && (Na = yd()), Na) : (t = fe, t !== 0 || (t = window.event, t = t === void 0 ? 16 : Cd(t.type)), t);
    }
    function hr(t, e, r, n) {
      if (50 < Xs) throw Xs = 0, Ec = null, Error(P(185));
      di(t, r, n), ((se & 2) === 0 || t !== Ze) && (t === Ze && ((se & 2) === 0 && (ll |= r), Qe === 4 && pn(t, et)), Ot(t, n), r === 1 && se === 0 && (e.mode & 1) === 0 && (zo = Me() + 500, ol && Nn()));
    }
    function Ot(t, e) {
      var r = t.callbackNode;
      N0(t, e);
      var n = Ra(t, t === Ze ? et : 0);
      if (n === 0) r !== null && Kp(r), t.callbackNode = null, t.callbackPriority = 0;
      else if (e = n & -n, t.callbackPriority !== e) {
        if (r != null && Kp(r), e === 1) t.tag === 0 ? Aw(Qf.bind(null, t)) : Gd(Qf.bind(null, t)), vw(function() {
          (se & 6) === 0 && Nn();
        }), r = null;
        else {
          switch (vd(n)) {
            case 1:
              r = qc;
              break;
            case 4:
              r = _d;
              break;
            case 16:
              r = Ma;
              break;
            case 536870912:
              r = xd;
              break;
            default:
              r = Ma;
          }
          r = Bm(r, Pm.bind(null, t));
        }
        t.callbackPriority = e, t.callbackNode = r;
      }
    }
    function Pm(t, e) {
      if (Ca = -1, Na = 0, (se & 6) !== 0) throw Error(P(327));
      var r = t.callbackNode;
      if (Fo() && t.callbackNode !== r) return null;
      var n = Ra(t, t === Ze ? et : 0);
      if (n === 0) return null;
      if ((n & 30) !== 0 || (n & t.expiredLanes) !== 0 || e) e = Za(t, n);
      else {
        e = n;
        var o = se;
        se |= 2;
        var s = Lm();
        (Ze !== t || et !== e) && (qr = null, zo = Me() + 500, Un(t, e));
        do
          try {
            Gw();
            break;
          } catch (a) {
            Vm(t, a);
          }
        while (true);
        Kc(), $a.current = s, se = o, Le !== null ? e = 0 : (Ze = null, et = 0, e = Qe);
      }
      if (e !== 0) {
        if (e === 2 && (o = rc(t), o !== 0 && (n = o, e = bc(t, o))), e === 1) throw r = fi, Un(t, 0), pn(t, n), Ot(t, Me()), r;
        if (e === 6) pn(t, n);
        else {
          if (o = t.current.alternate, (n & 30) === 0 && !Bw(o) && (e = Za(t, n), e === 2 && (s = rc(t), s !== 0 && (n = s, e = bc(t, s))), e === 1)) throw r = fi, Un(t, 0), pn(t, n), Ot(t, Me()), r;
          switch (t.finishedWork = o, t.finishedLanes = n, e) {
            case 0:
            case 1:
              throw Error(P(345));
            case 2:
              jn(t, At, qr);
              break;
            case 3:
              if (pn(t, n), (n & 130023424) === n && (e = fh + 500 - Me(), 10 < e)) {
                if (Ra(t, 0) !== 0) break;
                if (o = t.suspendedLanes, (o & n) !== n) {
                  mt(), t.pingedLanes |= t.suspendedLanes & o;
                  break;
                }
                t.timeoutHandle = cc(jn.bind(null, t, At, qr), e);
                break;
              }
              jn(t, At, qr);
              break;
            case 4:
              if (pn(t, n), (n & 4194240) === n) break;
              for (e = t.eventTimes, o = -1; 0 < n; ) {
                var i = 31 - cr(n);
                s = 1 << i, i = e[i], i > o && (o = i), n &= ~s;
              }
              if (n = o, n = Me() - n, n = (120 > n ? 120 : 480 > n ? 480 : 1080 > n ? 1080 : 1920 > n ? 1920 : 3e3 > n ? 3e3 : 4320 > n ? 4320 : 1960 * Ww(n / 1960)) - n, 10 < n) {
                t.timeoutHandle = cc(jn.bind(null, t, At, qr), n);
                break;
              }
              jn(t, At, qr);
              break;
            case 5:
              jn(t, At, qr);
              break;
            default:
              throw Error(P(329));
          }
        }
      }
      return Ot(t, Me()), t.callbackNode === r ? Pm.bind(null, t) : null;
    }
    function bc(t, e) {
      var r = Ys;
      return t.current.memoizedState.isDehydrated && (Un(t, e).flags |= 256), t = Za(t, e), t !== 2 && (e = At, At = r, e !== null && Dc(e)), t;
    }
    function Dc(t) {
      At === null ? At = t : At.push.apply(At, t);
    }
    function Bw(t) {
      for (var e = t; ; ) {
        if (e.flags & 16384) {
          var r = e.updateQueue;
          if (r !== null && (r = r.stores, r !== null)) for (var n = 0; n < r.length; n++) {
            var o = r[n], s = o.getSnapshot;
            o = o.value;
            try {
              if (!pr(s(), o)) return false;
            } catch {
              return false;
            }
          }
        }
        if (r = e.child, e.subtreeFlags & 16384 && r !== null) r.return = e, e = r;
        else {
          if (e === t) break;
          for (; e.sibling === null; ) {
            if (e.return === null || e.return === t) return true;
            e = e.return;
          }
          e.sibling.return = e.return, e = e.sibling;
        }
      }
      return true;
    }
    function pn(t, e) {
      for (e &= ~ph, e &= ~ll, t.suspendedLanes |= e, t.pingedLanes &= ~e, t = t.expirationTimes; 0 < e; ) {
        var r = 31 - cr(e), n = 1 << r;
        t[r] = -1, e &= ~n;
      }
    }
    function Qf(t) {
      if ((se & 6) !== 0) throw Error(P(327));
      Fo();
      var e = Ra(t, 0);
      if ((e & 1) === 0) return Ot(t, Me()), null;
      var r = Za(t, e);
      if (t.tag !== 0 && r === 2) {
        var n = rc(t);
        n !== 0 && (e = n, r = bc(t, n));
      }
      if (r === 1) throw r = fi, Un(t, 0), pn(t, e), Ot(t, Me()), r;
      if (r === 6) throw Error(P(345));
      return t.finishedWork = t.current.alternate, t.finishedLanes = e, jn(t, At, qr), Ot(t, Me()), null;
    }
    function dh(t, e) {
      var r = se;
      se |= 1;
      try {
        return t(e);
      } finally {
        se = r, se === 0 && (zo = Me() + 500, ol && Nn());
      }
    }
    function Xn(t) {
      dn !== null && dn.tag === 0 && (se & 6) === 0 && Fo();
      var e = se;
      se |= 1;
      var r = Xt.transition, n = fe;
      try {
        if (Xt.transition = null, fe = 1, t) return t();
      } finally {
        fe = n, Xt.transition = r, se = e, (se & 6) === 0 && Nn();
      }
    }
    function mh() {
      Rt = Oo.current, we(Oo);
    }
    function Un(t, e) {
      t.finishedWork = null, t.finishedLanes = 0;
      var r = t.timeoutHandle;
      if (r !== -1 && (t.timeoutHandle = -1, yw(r)), Le !== null) for (r = Le.return; r !== null; ) {
        var n = r;
        switch (Yc(n), n.tag) {
          case 1:
            n = n.type.childContextTypes, n != null && La();
            break;
          case 3:
            qo(), we(Ct), we(ut), oh();
            break;
          case 5:
            nh(n);
            break;
          case 4:
            qo();
            break;
          case 13:
            we(ke);
            break;
          case 19:
            we(ke);
            break;
          case 10:
            Jc(n.type._context);
            break;
          case 22:
          case 23:
            mh();
        }
        r = r.return;
      }
      if (Ze = t, Le = t = Sn(t.current, null), et = Rt = e, Qe = 0, fi = null, ph = ll = Yn = 0, At = Ys = null, Wn !== null) {
        for (e = 0; e < Wn.length; e++) if (r = Wn[e], n = r.interleaved, n !== null) {
          r.interleaved = null;
          var o = n.next, s = r.pending;
          if (s !== null) {
            var i = s.next;
            s.next = o, n.next = i;
          }
          r.pending = n;
        }
        Wn = null;
      }
      return t;
    }
    function Vm(t, e) {
      do {
        var r = Le;
        try {
          if (Kc(), Ta.current = Ha, Qa) {
            for (var n = Ce.memoizedState; n !== null; ) {
              var o = n.queue;
              o !== null && (o.pending = null), n = n.next;
            }
            Qa = false;
          }
          if ($n = 0, Xe = Ge = Ce = null, Hs = false, ci = 0, hh.current = null, r === null || r.return === null) {
            Qe = 1, fi = e, Le = null;
            break;
          }
          e: {
            var s = t, i = r.return, a = r, l = e;
            if (e = et, a.flags |= 32768, l !== null && typeof l == "object" && typeof l.then == "function") {
              var u = l, c = a, h = c.tag;
              if ((c.mode & 1) === 0 && (h === 0 || h === 11 || h === 15)) {
                var p = c.alternate;
                p ? (c.updateQueue = p.updateQueue, c.memoizedState = p.memoizedState, c.lanes = p.lanes) : (c.updateQueue = null, c.memoizedState = null);
              }
              var d = Rf(i);
              if (d !== null) {
                d.flags &= -257, Ff(d, i, a, s, e), d.mode & 1 && Mf(s, u, e), e = d, l = u;
                var m = e.updateQueue;
                if (m === null) {
                  var y = /* @__PURE__ */ new Set();
                  y.add(l), e.updateQueue = y;
                } else m.add(l);
                break e;
              } else {
                if ((e & 1) === 0) {
                  Mf(s, u, e), gh();
                  break e;
                }
                l = Error(P(426));
              }
            } else if (Se && a.mode & 1) {
              var T = Rf(i);
              if (T !== null) {
                (T.flags & 65536) === 0 && (T.flags |= 256), Ff(T, i, a, s, e), Xc(jo(l, a));
                break e;
              }
            }
            s = l = jo(l, a), Qe !== 4 && (Qe = 2), Ys === null ? Ys = [s] : Ys.push(s), s = i;
            do {
              switch (s.tag) {
                case 3:
                  s.flags |= 65536, e &= -e, s.lanes |= e;
                  var f = vm(s, l, e);
                  Cf(s, f);
                  break e;
                case 1:
                  a = l;
                  var g = s.type, v = s.stateNode;
                  if ((s.flags & 128) === 0 && (typeof g.getDerivedStateFromError == "function" || v !== null && typeof v.componentDidCatch == "function" && (vn === null || !vn.has(v)))) {
                    s.flags |= 65536, e &= -e, s.lanes |= e;
                    var k = wm(s, a, e);
                    Cf(s, k);
                    break e;
                  }
              }
              s = s.return;
            } while (s !== null);
          }
          jm(r);
        } catch (w) {
          e = w, Le === r && r !== null && (Le = r = r.return);
          continue;
        }
        break;
      } while (true);
    }
    function Lm() {
      var t = $a.current;
      return $a.current = Ha, t === null ? Ha : t;
    }
    function gh() {
      (Qe === 0 || Qe === 3 || Qe === 2) && (Qe = 4), Ze === null || (Yn & 268435455) === 0 && (ll & 268435455) === 0 || pn(Ze, et);
    }
    function Za(t, e) {
      var r = se;
      se |= 2;
      var n = Lm();
      (Ze !== t || et !== e) && (qr = null, Un(t, e));
      do
        try {
          Uw();
          break;
        } catch (o) {
          Vm(t, o);
        }
      while (true);
      if (Kc(), se = r, $a.current = n, Le !== null) throw Error(P(261));
      return Ze = null, et = 0, Qe;
    }
    function Uw() {
      for (; Le !== null; ) qm(Le);
    }
    function Gw() {
      for (; Le !== null && !x0(); ) qm(Le);
    }
    function qm(t) {
      var e = Wm(t.alternate, t, Rt);
      t.memoizedProps = t.pendingProps, e === null ? jm(t) : Le = e, hh.current = null;
    }
    function jm(t) {
      var e = t;
      do {
        var r = e.alternate;
        if (t = e.return, (e.flags & 32768) === 0) {
          if (r = Vw(r, e, Rt), r !== null) {
            Le = r;
            return;
          }
        } else {
          if (r = Lw(r, e), r !== null) {
            r.flags &= 32767, Le = r;
            return;
          }
          if (t !== null) t.flags |= 32768, t.subtreeFlags = 0, t.deletions = null;
          else {
            Qe = 6, Le = null;
            return;
          }
        }
        if (e = e.sibling, e !== null) {
          Le = e;
          return;
        }
        Le = e = t;
      } while (e !== null);
      Qe === 0 && (Qe = 5);
    }
    function jn(t, e, r) {
      var n = fe, o = Xt.transition;
      try {
        Xt.transition = null, fe = 1, Qw(t, e, r, n);
      } finally {
        Xt.transition = o, fe = n;
      }
      return null;
    }
    function Qw(t, e, r, n) {
      do
        Fo();
      while (dn !== null);
      if ((se & 6) !== 0) throw Error(P(327));
      r = t.finishedWork;
      var o = t.finishedLanes;
      if (r === null) return null;
      if (t.finishedWork = null, t.finishedLanes = 0, r === t.current) throw Error(P(177));
      t.callbackNode = null, t.callbackPriority = 0;
      var s = r.lanes | r.childLanes;
      if (O0(t, s), t === Ze && (Le = Ze = null, et = 0), (r.subtreeFlags & 2064) === 0 && (r.flags & 2064) === 0 || xa || (xa = true, Bm(Ma, function() {
        return Fo(), null;
      })), s = (r.flags & 15990) !== 0, (r.subtreeFlags & 15990) !== 0 || s) {
        s = Xt.transition, Xt.transition = null;
        var i = fe;
        fe = 1;
        var a = se;
        se |= 4, hh.current = null, jw(t, r), Fm(r, t), dw(lc), Fa = !!ac, lc = ac = null, t.current = r, zw(r, t, o), y0(), se = a, fe = i, Xt.transition = s;
      } else t.current = r;
      if (xa && (xa = false, dn = t, Xa = o), s = t.pendingLanes, s === 0 && (vn = null), S0(r.stateNode, n), Ot(t, Me()), e !== null) for (n = t.onRecoverableError, r = 0; r < e.length; r++) o = e[r], n(o.value, { componentStack: o.stack, digest: o.digest });
      if (Ya) throw Ya = false, t = Oc, Oc = null, t;
      return (Xa & 1) !== 0 && t.tag !== 0 && Fo(), s = t.pendingLanes, (s & 1) !== 0 ? t === Ec ? Xs++ : (Xs = 0, Ec = t) : Xs = 0, Nn(), null;
    }
    function Fo() {
      if (dn !== null) {
        var t = vd(Xa), e = Xt.transition, r = fe;
        try {
          if (Xt.transition = null, fe = 16 > t ? 16 : t, dn === null) var n = false;
          else {
            if (t = dn, dn = null, Xa = 0, (se & 6) !== 0) throw Error(P(331));
            var o = se;
            for (se |= 4, U = t.current; U !== null; ) {
              var s = U, i = s.child;
              if ((U.flags & 16) !== 0) {
                var a = s.deletions;
                if (a !== null) {
                  for (var l = 0; l < a.length; l++) {
                    var u = a[l];
                    for (U = u; U !== null; ) {
                      var c = U;
                      switch (c.tag) {
                        case 0:
                        case 11:
                        case 15:
                          $s(8, c, s);
                      }
                      var h = c.child;
                      if (h !== null) h.return = c, U = h;
                      else for (; U !== null; ) {
                        c = U;
                        var p = c.sibling, d = c.return;
                        if (Dm(c), c === u) {
                          U = null;
                          break;
                        }
                        if (p !== null) {
                          p.return = d, U = p;
                          break;
                        }
                        U = d;
                      }
                    }
                  }
                  var m = s.alternate;
                  if (m !== null) {
                    var y = m.child;
                    if (y !== null) {
                      m.child = null;
                      do {
                        var T = y.sibling;
                        y.sibling = null, y = T;
                      } while (y !== null);
                    }
                  }
                  U = s;
                }
              }
              if ((s.subtreeFlags & 2064) !== 0 && i !== null) i.return = s, U = i;
              else e: for (; U !== null; ) {
                if (s = U, (s.flags & 2048) !== 0) switch (s.tag) {
                  case 0:
                  case 11:
                  case 15:
                    $s(9, s, s.return);
                }
                var f = s.sibling;
                if (f !== null) {
                  f.return = s.return, U = f;
                  break e;
                }
                U = s.return;
              }
            }
            var g = t.current;
            for (U = g; U !== null; ) {
              i = U;
              var v = i.child;
              if ((i.subtreeFlags & 2064) !== 0 && v !== null) v.return = i, U = v;
              else e: for (i = g; U !== null; ) {
                if (a = U, (a.flags & 2048) !== 0) try {
                  switch (a.tag) {
                    case 0:
                    case 11:
                    case 15:
                      al(9, a);
                  }
                } catch (w) {
                  be(a, a.return, w);
                }
                if (a === i) {
                  U = null;
                  break e;
                }
                var k = a.sibling;
                if (k !== null) {
                  k.return = a.return, U = k;
                  break e;
                }
                U = a.return;
              }
            }
            if (se = o, Nn(), Nr && typeof Nr.onPostCommitFiberRoot == "function") try {
              Nr.onPostCommitFiberRoot(Ja, t);
            } catch {
            }
            n = true;
          }
          return n;
        } finally {
          fe = r, Xt.transition = e;
        }
      }
      return false;
    }
    function Hf(t, e, r) {
      e = jo(r, e), e = vm(t, e, 1), t = yn(t, e, 1), e = mt(), t !== null && (di(t, 1, e), Ot(t, e));
    }
    function be(t, e, r) {
      if (t.tag === 3) Hf(t, t, r);
      else for (; e !== null; ) {
        if (e.tag === 3) {
          Hf(e, t, r);
          break;
        } else if (e.tag === 1) {
          var n = e.stateNode;
          if (typeof e.type.getDerivedStateFromError == "function" || typeof n.componentDidCatch == "function" && (vn === null || !vn.has(n))) {
            t = jo(r, t), t = wm(e, t, 1), e = yn(e, t, 1), t = mt(), e !== null && (di(e, 1, t), Ot(e, t));
            break;
          }
        }
        e = e.return;
      }
    }
    function Hw(t, e, r) {
      var n = t.pingCache;
      n !== null && n.delete(e), e = mt(), t.pingedLanes |= t.suspendedLanes & r, Ze === t && (et & r) === r && (Qe === 4 || Qe === 3 && (et & 130023424) === et && 500 > Me() - fh ? Un(t, 0) : ph |= r), Ot(t, e);
    }
    function zm(t, e) {
      e === 0 && ((t.mode & 1) === 0 ? e = 1 : (e = oa, oa <<= 1, (oa & 130023424) === 0 && (oa = 4194304)));
      var r = mt();
      t = Qr(t, e), t !== null && (di(t, e, r), Ot(t, r));
    }
    function $w(t) {
      var e = t.memoizedState, r = 0;
      e !== null && (r = e.retryLane), zm(t, r);
    }
    function Yw(t, e) {
      var r = 0;
      switch (t.tag) {
        case 13:
          var n = t.stateNode, o = t.memoizedState;
          o !== null && (r = o.retryLane);
          break;
        case 19:
          n = t.stateNode;
          break;
        default:
          throw Error(P(314));
      }
      n !== null && n.delete(e), zm(t, r);
    }
    var Wm;
    Wm = function(t, e, r) {
      if (t !== null) if (t.memoizedProps !== e.pendingProps || Ct.current) kt = true;
      else {
        if ((t.lanes & r) === 0 && (e.flags & 128) === 0) return kt = false, Pw(t, e, r);
        kt = (t.flags & 131072) !== 0;
      }
      else kt = false, Se && (e.flags & 1048576) !== 0 && Qd(e, za, e.index);
      switch (e.lanes = 0, e.tag) {
        case 2:
          var n = e.type;
          ka(t, e), t = e.pendingProps;
          var o = Po(e, ut.current);
          Ro(e, r), o = ih(null, e, n, t, o, r);
          var s = ah();
          return e.flags |= 1, typeof o == "object" && o !== null && typeof o.render == "function" && o.$$typeof === void 0 ? (e.tag = 1, e.memoizedState = null, e.updateQueue = null, Nt(n) ? (s = true, qa(e)) : s = false, e.memoizedState = o.state !== null && o.state !== void 0 ? o.state : null, th(e), o.updater = il, e.stateNode = o, o._reactInternals = e, _c(e, n, t, r), e = vc(null, e, n, true, s, r)) : (e.tag = 0, Se && s && $c(e), dt(null, e, o, r), e = e.child), e;
        case 16:
          n = e.elementType;
          e: {
            switch (ka(t, e), t = e.pendingProps, o = n._init, n = o(n._payload), e.type = n, o = e.tag = Zw(n), t = ar(n, t), o) {
              case 0:
                e = yc(null, e, n, t, r);
                break e;
              case 1:
                e = Vf(null, e, n, t, r);
                break e;
              case 11:
                e = If(null, e, n, t, r);
                break e;
              case 14:
                e = Pf(null, e, n, ar(n.type, t), r);
                break e;
            }
            throw Error(P(306, n, ""));
          }
          return e;
        case 0:
          return n = e.type, o = e.pendingProps, o = e.elementType === n ? o : ar(n, o), yc(t, e, n, o, r);
        case 1:
          return n = e.type, o = e.pendingProps, o = e.elementType === n ? o : ar(n, o), Vf(t, e, n, o, r);
        case 3:
          e: {
            if (km(e), t === null) throw Error(P(387));
            n = e.pendingProps, s = e.memoizedState, o = s.element, Kd(t, e), Ua(e, n, null, r);
            var i = e.memoizedState;
            if (n = i.element, s.isDehydrated) if (s = { element: n, isDehydrated: false, cache: i.cache, pendingSuspenseBoundaries: i.pendingSuspenseBoundaries, transitions: i.transitions }, e.updateQueue.baseState = s, e.memoizedState = s, e.flags & 256) {
              o = jo(Error(P(423)), e), e = Lf(t, e, n, r, o);
              break e;
            } else if (n !== o) {
              o = jo(Error(P(424)), e), e = Lf(t, e, n, r, o);
              break e;
            } else for (Ft = xn(e.stateNode.containerInfo.firstChild), It = e, Se = true, ur = null, r = Xd(e, null, n, r), e.child = r; r; ) r.flags = r.flags & -3 | 4096, r = r.sibling;
            else {
              if (Vo(), n === o) {
                e = Hr(t, e, r);
                break e;
              }
              dt(t, e, n, r);
            }
            e = e.child;
          }
          return e;
        case 5:
          return Jd(e), t === null && dc(e), n = e.type, o = e.pendingProps, s = t !== null ? t.memoizedProps : null, i = o.children, uc(n, o) ? i = null : s !== null && uc(n, s) && (e.flags |= 32), Am(t, e), dt(t, e, i, r), e.child;
        case 6:
          return t === null && dc(e), null;
        case 13:
          return Cm(t, e, r);
        case 4:
          return rh(e, e.stateNode.containerInfo), n = e.pendingProps, t === null ? e.child = Lo(e, null, n, r) : dt(t, e, n, r), e.child;
        case 11:
          return n = e.type, o = e.pendingProps, o = e.elementType === n ? o : ar(n, o), If(t, e, n, o, r);
        case 7:
          return dt(t, e, e.pendingProps, r), e.child;
        case 8:
          return dt(t, e, e.pendingProps.children, r), e.child;
        case 12:
          return dt(t, e, e.pendingProps.children, r), e.child;
        case 10:
          e: {
            if (n = e.type._context, o = e.pendingProps, s = e.memoizedProps, i = o.value, xe(Wa, n._currentValue), n._currentValue = i, s !== null) if (pr(s.value, i)) {
              if (s.children === o.children && !Ct.current) {
                e = Hr(t, e, r);
                break e;
              }
            } else for (s = e.child, s !== null && (s.return = e); s !== null; ) {
              var a = s.dependencies;
              if (a !== null) {
                i = s.child;
                for (var l = a.firstContext; l !== null; ) {
                  if (l.context === n) {
                    if (s.tag === 1) {
                      l = Br(-1, r & -r), l.tag = 2;
                      var u = s.updateQueue;
                      if (u !== null) {
                        u = u.shared;
                        var c = u.pending;
                        c === null ? l.next = l : (l.next = c.next, c.next = l), u.pending = l;
                      }
                    }
                    s.lanes |= r, l = s.alternate, l !== null && (l.lanes |= r), mc(s.return, r, e), a.lanes |= r;
                    break;
                  }
                  l = l.next;
                }
              } else if (s.tag === 10) i = s.type === e.type ? null : s.child;
              else if (s.tag === 18) {
                if (i = s.return, i === null) throw Error(P(341));
                i.lanes |= r, a = i.alternate, a !== null && (a.lanes |= r), mc(i, r, e), i = s.sibling;
              } else i = s.child;
              if (i !== null) i.return = s;
              else for (i = s; i !== null; ) {
                if (i === e) {
                  i = null;
                  break;
                }
                if (s = i.sibling, s !== null) {
                  s.return = i.return, i = s;
                  break;
                }
                i = i.return;
              }
              s = i;
            }
            dt(t, e, o.children, r), e = e.child;
          }
          return e;
        case 9:
          return o = e.type, n = e.pendingProps.children, Ro(e, r), o = Zt(o), n = n(o), e.flags |= 1, dt(t, e, n, r), e.child;
        case 14:
          return n = e.type, o = ar(n, e.pendingProps), o = ar(n.type, o), Pf(t, e, n, o, r);
        case 15:
          return Sm(t, e, e.type, e.pendingProps, r);
        case 17:
          return n = e.type, o = e.pendingProps, o = e.elementType === n ? o : ar(n, o), ka(t, e), e.tag = 1, Nt(n) ? (t = true, qa(e)) : t = false, Ro(e, r), ym(e, n, o), _c(e, n, o, r), vc(null, e, n, true, t, r);
        case 19:
          return Nm(t, e, r);
        case 22:
          return Tm(t, e, r);
      }
      throw Error(P(156, e.tag));
    };
    function Bm(t, e) {
      return gd(t, e);
    }
    function Xw(t, e, r, n) {
      this.tag = t, this.key = r, this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null, this.index = 0, this.ref = null, this.pendingProps = e, this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null, this.mode = n, this.subtreeFlags = this.flags = 0, this.deletions = null, this.childLanes = this.lanes = 0, this.alternate = null;
    }
    function Yt(t, e, r, n) {
      return new Xw(t, e, r, n);
    }
    function _h(t) {
      return t = t.prototype, !(!t || !t.isReactComponent);
    }
    function Zw(t) {
      if (typeof t == "function") return _h(t) ? 1 : 0;
      if (t != null) {
        if (t = t.$$typeof, t === Pc) return 11;
        if (t === Vc) return 14;
      }
      return 2;
    }
    function Sn(t, e) {
      var r = t.alternate;
      return r === null ? (r = Yt(t.tag, e, t.key, t.mode), r.elementType = t.elementType, r.type = t.type, r.stateNode = t.stateNode, r.alternate = t, t.alternate = r) : (r.pendingProps = e, r.type = t.type, r.flags = 0, r.subtreeFlags = 0, r.deletions = null), r.flags = t.flags & 14680064, r.childLanes = t.childLanes, r.lanes = t.lanes, r.child = t.child, r.memoizedProps = t.memoizedProps, r.memoizedState = t.memoizedState, r.updateQueue = t.updateQueue, e = t.dependencies, r.dependencies = e === null ? null : { lanes: e.lanes, firstContext: e.firstContext }, r.sibling = t.sibling, r.index = t.index, r.ref = t.ref, r;
    }
    function Oa(t, e, r, n, o, s) {
      var i = 2;
      if (n = t, typeof t == "function") _h(t) && (i = 1);
      else if (typeof t == "string") i = 5;
      else e: switch (t) {
        case xo:
          return Gn(r.children, o, s, e);
        case Ic:
          i = 8, o |= 8;
          break;
        case zu:
          return t = Yt(12, r, e, o | 2), t.elementType = zu, t.lanes = s, t;
        case Wu:
          return t = Yt(13, r, e, o), t.elementType = Wu, t.lanes = s, t;
        case Bu:
          return t = Yt(19, r, e, o), t.elementType = Bu, t.lanes = s, t;
        case Jf:
          return ul(r, o, s, e);
        default:
          if (typeof t == "object" && t !== null) switch (t.$$typeof) {
            case Zf:
              i = 10;
              break e;
            case Kf:
              i = 9;
              break e;
            case Pc:
              i = 11;
              break e;
            case Vc:
              i = 14;
              break e;
            case un:
              i = 16, n = null;
              break e;
          }
          throw Error(P(130, t == null ? t : typeof t, ""));
      }
      return e = Yt(i, r, e, o), e.elementType = t, e.type = n, e.lanes = s, e;
    }
    function Gn(t, e, r, n) {
      return t = Yt(7, t, n, e), t.lanes = r, t;
    }
    function ul(t, e, r, n) {
      return t = Yt(22, t, n, e), t.elementType = Jf, t.lanes = r, t.stateNode = { isHidden: false }, t;
    }
    function Lu(t, e, r) {
      return t = Yt(6, t, null, e), t.lanes = r, t;
    }
    function qu(t, e, r) {
      return e = Yt(4, t.children !== null ? t.children : [], t.key, e), e.lanes = r, e.stateNode = { containerInfo: t.containerInfo, pendingChildren: null, implementation: t.implementation }, e;
    }
    function Kw(t, e, r, n, o) {
      this.tag = e, this.containerInfo = t, this.finishedWork = this.pingCache = this.current = this.pendingChildren = null, this.timeoutHandle = -1, this.callbackNode = this.pendingContext = this.context = null, this.callbackPriority = 0, this.eventTimes = Su(0), this.expirationTimes = Su(-1), this.entangledLanes = this.finishedLanes = this.mutableReadLanes = this.expiredLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0, this.entanglements = Su(0), this.identifierPrefix = n, this.onRecoverableError = o, this.mutableSourceEagerHydrationData = null;
    }
    function xh(t, e, r, n, o, s, i, a, l) {
      return t = new Kw(t, e, r, a, l), e === 1 ? (e = 1, s === true && (e |= 8)) : e = 0, s = Yt(3, null, null, e), t.current = s, s.stateNode = t, s.memoizedState = { element: n, isDehydrated: r, cache: null, transitions: null, pendingSuspenseBoundaries: null }, th(s), t;
    }
    function Jw(t, e, r) {
      var n = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
      return { $$typeof: _o, key: n == null ? null : "" + n, children: t, containerInfo: e, implementation: r };
    }
    function Um(t) {
      if (!t) return An;
      t = t._reactInternals;
      e: {
        if (Kn(t) !== t || t.tag !== 1) throw Error(P(170));
        var e = t;
        do {
          switch (e.tag) {
            case 3:
              e = e.stateNode.context;
              break e;
            case 1:
              if (Nt(e.type)) {
                e = e.stateNode.__reactInternalMemoizedMergedChildContext;
                break e;
              }
          }
          e = e.return;
        } while (e !== null);
        throw Error(P(171));
      }
      if (t.tag === 1) {
        var r = t.type;
        if (Nt(r)) return Ud(t, r, e);
      }
      return e;
    }
    function Gm(t, e, r, n, o, s, i, a, l) {
      return t = xh(r, n, true, t, o, s, i, a, l), t.context = Um(null), r = t.current, n = mt(), o = wn(r), s = Br(n, o), s.callback = e ?? null, yn(r, s, o), t.current.lanes = o, di(t, o, n), Ot(t, n), t;
    }
    function cl(t, e, r, n) {
      var o = e.current, s = mt(), i = wn(o);
      return r = Um(r), e.context === null ? e.context = r : e.pendingContext = r, e = Br(s, i), e.payload = { element: t }, n = n === void 0 ? null : n, n !== null && (e.callback = n), t = yn(o, e, i), t !== null && (hr(t, o, i, s), Sa(t, o, i)), i;
    }
    function Ka(t) {
      if (t = t.current, !t.child) return null;
      switch (t.child.tag) {
        case 5:
          return t.child.stateNode;
        default:
          return t.child.stateNode;
      }
    }
    function $f(t, e) {
      if (t = t.memoizedState, t !== null && t.dehydrated !== null) {
        var r = t.retryLane;
        t.retryLane = r !== 0 && r < e ? r : e;
      }
    }
    function yh(t, e) {
      $f(t, e), (t = t.alternate) && $f(t, e);
    }
    function e1() {
      return null;
    }
    var Qm = typeof reportError == "function" ? reportError : function(t) {
      console.error(t);
    };
    function vh(t) {
      this._internalRoot = t;
    }
    hl.prototype.render = vh.prototype.render = function(t) {
      var e = this._internalRoot;
      if (e === null) throw Error(P(409));
      cl(t, e, null, null);
    };
    hl.prototype.unmount = vh.prototype.unmount = function() {
      var t = this._internalRoot;
      if (t !== null) {
        this._internalRoot = null;
        var e = t.containerInfo;
        Xn(function() {
          cl(null, t, null, null);
        }), e[Gr] = null;
      }
    };
    function hl(t) {
      this._internalRoot = t;
    }
    hl.prototype.unstable_scheduleHydration = function(t) {
      if (t) {
        var e = Td();
        t = { blockedOn: null, target: t, priority: e };
        for (var r = 0; r < hn.length && e !== 0 && e < hn[r].priority; r++) ;
        hn.splice(r, 0, t), r === 0 && kd(t);
      }
    };
    function wh(t) {
      return !(!t || t.nodeType !== 1 && t.nodeType !== 9 && t.nodeType !== 11);
    }
    function pl(t) {
      return !(!t || t.nodeType !== 1 && t.nodeType !== 9 && t.nodeType !== 11 && (t.nodeType !== 8 || t.nodeValue !== " react-mount-point-unstable "));
    }
    function Yf() {
    }
    function t1(t, e, r, n, o) {
      if (o) {
        if (typeof n == "function") {
          var s = n;
          n = function() {
            var u = Ka(i);
            s.call(u);
          };
        }
        var i = Gm(e, n, t, 0, null, false, false, "", Yf);
        return t._reactRootContainer = i, t[Gr] = i.current, si(t.nodeType === 8 ? t.parentNode : t), Xn(), i;
      }
      for (; o = t.lastChild; ) t.removeChild(o);
      if (typeof n == "function") {
        var a = n;
        n = function() {
          var u = Ka(l);
          a.call(u);
        };
      }
      var l = xh(t, 0, false, null, null, false, false, "", Yf);
      return t._reactRootContainer = l, t[Gr] = l.current, si(t.nodeType === 8 ? t.parentNode : t), Xn(function() {
        cl(e, l, r, n);
      }), l;
    }
    function fl(t, e, r, n, o) {
      var s = r._reactRootContainer;
      if (s) {
        var i = s;
        if (typeof o == "function") {
          var a = o;
          o = function() {
            var l = Ka(i);
            a.call(l);
          };
        }
        cl(e, i, t, o);
      } else i = t1(r, e, t, o, n);
      return Ka(i);
    }
    wd = function(t) {
      switch (t.tag) {
        case 3:
          var e = t.stateNode;
          if (e.current.memoizedState.isDehydrated) {
            var r = js(e.pendingLanes);
            r !== 0 && (jc(e, r | 1), Ot(e, Me()), (se & 6) === 0 && (zo = Me() + 500, Nn()));
          }
          break;
        case 13:
          Xn(function() {
            var n = Qr(t, 1);
            if (n !== null) {
              var o = mt();
              hr(n, t, 1, o);
            }
          }), yh(t, 1);
      }
    };
    zc = function(t) {
      if (t.tag === 13) {
        var e = Qr(t, 134217728);
        if (e !== null) {
          var r = mt();
          hr(e, t, 134217728, r);
        }
        yh(t, 134217728);
      }
    };
    Sd = function(t) {
      if (t.tag === 13) {
        var e = wn(t), r = Qr(t, e);
        if (r !== null) {
          var n = mt();
          hr(r, t, e, n);
        }
        yh(t, e);
      }
    };
    Td = function() {
      return fe;
    };
    Ad = function(t, e) {
      var r = fe;
      try {
        return fe = t, e();
      } finally {
        fe = r;
      }
    };
    Ju = function(t, e, r) {
      switch (e) {
        case "input":
          if (Qu(t, r), e = r.name, r.type === "radio" && e != null) {
            for (r = t; r.parentNode; ) r = r.parentNode;
            for (r = r.querySelectorAll("input[name=" + JSON.stringify("" + e) + '][type="radio"]'), e = 0; e < r.length; e++) {
              var n = r[e];
              if (n !== t && n.form === t.form) {
                var o = nl(n);
                if (!o) throw Error(P(90));
                td(n), Qu(n, o);
              }
            }
          }
          break;
        case "textarea":
          nd(t, r);
          break;
        case "select":
          e = r.value, e != null && Eo(t, !!r.multiple, e, false);
      }
    };
    cd = dh;
    hd = Xn;
    var r1 = { usingClientEntryPoint: false, Events: [gi, So, nl, ld, ud, dh] }, Ps = { findFiberByHostInstance: zn, bundleType: 0, version: "18.3.1", rendererPackageName: "react-dom" }, n1 = { bundleType: Ps.bundleType, version: Ps.version, rendererPackageName: Ps.rendererPackageName, rendererConfig: Ps.rendererConfig, overrideHookState: null, overrideHookStateDeletePath: null, overrideHookStateRenamePath: null, overrideProps: null, overridePropsDeletePath: null, overridePropsRenamePath: null, setErrorHandler: null, setSuspenseHandler: null, scheduleUpdate: null, currentDispatcherRef: $r.ReactCurrentDispatcher, findHostInstanceByFiber: function(t) {
      return t = dd(t), t === null ? null : t.stateNode;
    }, findFiberByHostInstance: Ps.findFiberByHostInstance || e1, findHostInstancesForRefresh: null, scheduleRefresh: null, scheduleRoot: null, setRefreshHandler: null, getCurrentFiber: null, reconcilerVersion: "18.3.1-next-f1338f8080-20240426" };
    if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" && (Vs = __REACT_DEVTOOLS_GLOBAL_HOOK__, !Vs.isDisabled && Vs.supportsFiber)) try {
      Ja = Vs.inject(n1), Nr = Vs;
    } catch {
    }
    var Vs;
    Lt.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = r1;
    Lt.createPortal = function(t, e) {
      var r = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
      if (!wh(e)) throw Error(P(200));
      return Jw(t, e, null, r);
    };
    Lt.createRoot = function(t, e) {
      if (!wh(t)) throw Error(P(299));
      var r = false, n = "", o = Qm;
      return e != null && (e.unstable_strictMode === true && (r = true), e.identifierPrefix !== void 0 && (n = e.identifierPrefix), e.onRecoverableError !== void 0 && (o = e.onRecoverableError)), e = xh(t, 1, false, null, null, r, false, n, o), t[Gr] = e.current, si(t.nodeType === 8 ? t.parentNode : t), new vh(e);
    };
    Lt.findDOMNode = function(t) {
      if (t == null) return null;
      if (t.nodeType === 1) return t;
      var e = t._reactInternals;
      if (e === void 0) throw typeof t.render == "function" ? Error(P(188)) : (t = Object.keys(t).join(","), Error(P(268, t)));
      return t = dd(e), t = t === null ? null : t.stateNode, t;
    };
    Lt.flushSync = function(t) {
      return Xn(t);
    };
    Lt.hydrate = function(t, e, r) {
      if (!pl(e)) throw Error(P(200));
      return fl(null, t, e, true, r);
    };
    Lt.hydrateRoot = function(t, e, r) {
      if (!wh(t)) throw Error(P(405));
      var n = r != null && r.hydratedSources || null, o = false, s = "", i = Qm;
      if (r != null && (r.unstable_strictMode === true && (o = true), r.identifierPrefix !== void 0 && (s = r.identifierPrefix), r.onRecoverableError !== void 0 && (i = r.onRecoverableError)), e = Gm(e, null, t, 1, r ?? null, o, false, s, i), t[Gr] = e.current, si(t), n) for (t = 0; t < n.length; t++) r = n[t], o = r._getVersion, o = o(r._source), e.mutableSourceEagerHydrationData == null ? e.mutableSourceEagerHydrationData = [r, o] : e.mutableSourceEagerHydrationData.push(r, o);
      return new hl(e);
    };
    Lt.render = function(t, e, r) {
      if (!pl(e)) throw Error(P(200));
      return fl(null, t, e, false, r);
    };
    Lt.unmountComponentAtNode = function(t) {
      if (!pl(t)) throw Error(P(40));
      return t._reactRootContainer ? (Xn(function() {
        fl(null, null, t, false, function() {
          t._reactRootContainer = null, t[Gr] = null;
        });
      }), true) : false;
    };
    Lt.unstable_batchedUpdates = dh;
    Lt.unstable_renderSubtreeIntoContainer = function(t, e, r, n) {
      if (!pl(r)) throw Error(P(200));
      if (t == null || t._reactInternals === void 0) throw Error(P(38));
      return fl(t, e, r, false, n);
    };
    Lt.version = "18.3.1-next-f1338f8080-20240426";
  });
  var Xm = Ue((jT, Ym) => {
    "use strict";
    function $m() {
      if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function")) try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE($m);
      } catch (t) {
        console.error(t);
      }
    }
    $m(), Ym.exports = Hm();
  });
  var Km = Ue((Sh) => {
    "use strict";
    var Zm = Xm();
    Sh.createRoot = Zm.createRoot, Sh.hydrateRoot = Zm.hydrateRoot;
    var zT;
  });
  var Jm = Ue((UT, yi) => {
    function o1(t) {
      if (Array.isArray(t)) return t;
    }
    yi.exports = o1, yi.exports.__esModule = true, yi.exports.default = yi.exports;
  });
  var eg = Ue((GT, vi) => {
    function s1(t, e) {
      var r = t == null ? null : typeof Symbol < "u" && t[Symbol.iterator] || t["@@iterator"];
      if (r != null) {
        var n, o, s, i, a = [], l = true, u = false;
        try {
          if (s = (r = r.call(t)).next, e === 0) {
            if (Object(r) !== r) return;
            l = false;
          } else for (; !(l = (n = s.call(r)).done) && (a.push(n.value), a.length !== e); l = true) ;
        } catch (c) {
          u = true, o = c;
        } finally {
          try {
            if (!l && r.return != null && (i = r.return(), Object(i) !== i)) return;
          } finally {
            if (u) throw o;
          }
        }
        return a;
      }
    }
    vi.exports = s1, vi.exports.__esModule = true, vi.exports.default = vi.exports;
  });
  var tg = Ue((QT, wi) => {
    function i1(t, e) {
      (e == null || e > t.length) && (e = t.length);
      for (var r = 0, n = Array(e); r < e; r++) n[r] = t[r];
      return n;
    }
    wi.exports = i1, wi.exports.__esModule = true, wi.exports.default = wi.exports;
  });
  var ng = Ue((HT, Si) => {
    var rg = tg();
    function a1(t, e) {
      if (t) {
        if (typeof t == "string") return rg(t, e);
        var r = {}.toString.call(t).slice(8, -1);
        return r === "Object" && t.constructor && (r = t.constructor.name), r === "Map" || r === "Set" ? Array.from(t) : r === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r) ? rg(t, e) : void 0;
      }
    }
    Si.exports = a1, Si.exports.__esModule = true, Si.exports.default = Si.exports;
  });
  var og = Ue(($T, Ti) => {
    function l1() {
      throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
    }
    Ti.exports = l1, Ti.exports.__esModule = true, Ti.exports.default = Ti.exports;
  });
  var sg = Ue((YT, Ai) => {
    var u1 = Jm(), c1 = eg(), h1 = ng(), p1 = og();
    function f1(t, e) {
      return u1(t) || c1(t, e) || h1(t, e) || p1();
    }
    Ai.exports = f1, Ai.exports.__esModule = true, Ai.exports.default = Ai.exports;
  });
  var ig = Ue((XT, ki) => {
    function d1(t, e) {
      if (!(t instanceof e)) throw new TypeError("Cannot call a class as a function");
    }
    ki.exports = d1, ki.exports.__esModule = true, ki.exports.default = ki.exports;
  });
  var Ah = Ue((ZT, Yr) => {
    function Th(t) {
      "@babel/helpers - typeof";
      return Yr.exports = Th = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(e) {
        return typeof e;
      } : function(e) {
        return e && typeof Symbol == "function" && e.constructor === Symbol && e !== Symbol.prototype ? "symbol" : typeof e;
      }, Yr.exports.__esModule = true, Yr.exports.default = Yr.exports, Th(t);
    }
    Yr.exports = Th, Yr.exports.__esModule = true, Yr.exports.default = Yr.exports;
  });
  var lg = Ue((KT, Ci) => {
    var ag = Ah().default;
    function m1(t, e) {
      if (ag(t) != "object" || !t) return t;
      var r = t[Symbol.toPrimitive];
      if (r !== void 0) {
        var n = r.call(t, e || "default");
        if (ag(n) != "object") return n;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return (e === "string" ? String : Number)(t);
    }
    Ci.exports = m1, Ci.exports.__esModule = true, Ci.exports.default = Ci.exports;
  });
  var ug = Ue((JT, Ni) => {
    var g1 = Ah().default, _1 = lg();
    function x1(t) {
      var e = _1(t, "string");
      return g1(e) == "symbol" ? e : e + "";
    }
    Ni.exports = x1, Ni.exports.__esModule = true, Ni.exports.default = Ni.exports;
  });
  var hg = Ue((eA, Oi) => {
    var y1 = ug();
    function cg(t, e) {
      for (var r = 0; r < e.length; r++) {
        var n = e[r];
        n.enumerable = n.enumerable || false, n.configurable = true, "value" in n && (n.writable = true), Object.defineProperty(t, y1(n.key), n);
      }
    }
    function v1(t, e, r) {
      return e && cg(t.prototype, e), r && cg(t, r), Object.defineProperty(t, "prototype", { writable: false }), t;
    }
    Oi.exports = v1, Oi.exports.__esModule = true, Oi.exports.default = Oi.exports;
  });
  var kh = Ue((dl, pg) => {
    (function(t, e) {
      typeof dl == "object" && typeof pg < "u" ? e(dl, sg(), ig(), hg()) : typeof define == "function" && define.amd ? define(["exports", "@babel/runtime/helpers/slicedToArray", "@babel/runtime/helpers/classCallCheck", "@babel/runtime/helpers/createClass"], e) : (t = typeof globalThis < "u" ? globalThis : t || self, e(t.automationEvents = {}, t._slicedToArray, t._classCallCheck, t._createClass));
    })(dl, (function(t, e, r, n) {
      "use strict";
      var o = function(N, S, b) {
        return { endTime: S, insertTime: b, type: "exponentialRampToValue", value: N };
      }, s = function(N, S, b) {
        return { endTime: S, insertTime: b, type: "linearRampToValue", value: N };
      }, i = function(N, S) {
        return { startTime: S, type: "setValue", value: N };
      }, a = function(N, S, b) {
        return { duration: b, startTime: S, type: "setValueCurve", values: N };
      }, l = function(N, S, b) {
        var M = b.startTime, I = b.target, R = b.timeConstant;
        return I + (S - I) * Math.exp((M - N) / R);
      }, u = function(N) {
        return N.type === "exponentialRampToValue";
      }, c = function(N) {
        return N.type === "linearRampToValue";
      }, h = function(N) {
        return u(N) || c(N);
      }, p = function(N) {
        return N.type === "setValue";
      }, d = function(N) {
        return N.type === "setValueCurve";
      }, m = function(N, S, b, M) {
        var I = N[S];
        return I === void 0 ? M : h(I) || p(I) ? I.value : d(I) ? I.values[I.values.length - 1] : l(b, m(N, S - 1, I.startTime, M), I);
      }, y = function(N, S, b, M, I) {
        return b === void 0 ? [M.insertTime, I] : h(b) ? [b.endTime, b.value] : p(b) ? [b.startTime, b.value] : d(b) ? [b.startTime + b.duration, b.values[b.values.length - 1]] : [b.startTime, m(N, S - 1, b.startTime, I)];
      }, T = function(N) {
        return N.type === "cancelAndHold";
      }, f = function(N) {
        return N.type === "cancelScheduledValues";
      }, g = function(N) {
        return T(N) || f(N) ? N.cancelTime : u(N) || c(N) ? N.endTime : N.startTime;
      }, v = function(N, S, b, M) {
        var I = M.endTime, R = M.value;
        return b === R ? R : 0 < b && 0 < R || b < 0 && R < 0 ? b * Math.pow(R / b, (N - S) / (I - S)) : N < I ? b : R;
      }, k = function(N, S, b, M) {
        var I = M.endTime, R = M.value;
        return b + (N - S) / (I - S) * (R - b);
      }, w = function(N, S) {
        var b = Math.floor(S);
        if (b === S) return N[b];
        var M = Math.ceil(S);
        return (1 - (S - b)) * N[b] + (1 - (M - S)) * N[M];
      }, A = function(N, S) {
        var b = S.duration, M = S.startTime, I = S.values, R = (N - M) / b * (I.length - 1);
        return w(I, R);
      }, C = function(N, S, b) {
        for (var M = N.length, I = Math.max(1, Math.floor(b / S * M)) + 1, R = N instanceof Float32Array ? new Float32Array(I) : N.slice(0, I), $ = 0; $ < I; $ += 1) {
          var Y = $ / (I - 1) * b, ee = Y / S * (M - 1);
          R[$] = w(N, ee);
        }
        return R;
      }, _ = function(N) {
        return N.type === "setTarget";
      }, x = (function() {
        function L(N) {
          r(this, L), this._automationEvents = [], this._currenTime = 0, this._defaultValue = N;
        }
        return n(L, [{ key: Symbol.iterator, value: function() {
          return this._automationEvents[Symbol.iterator]();
        } }, { key: "add", value: function(S) {
          var b = g(S);
          if (T(S) || f(S)) {
            var M = this._automationEvents.findIndex(function(ot) {
              return f(S) && d(ot) ? ot.startTime + ot.duration >= b : g(ot) >= b;
            }), I = this._automationEvents[M];
            if (M !== -1 && (this._automationEvents = this._automationEvents.slice(0, M)), T(S)) {
              var R = this._automationEvents[this._automationEvents.length - 1];
              if (I !== void 0 && h(I)) {
                if (R !== void 0 && _(R)) throw new Error("The internal list is malformed.");
                var $ = R === void 0 ? I.insertTime : d(R) ? R.startTime + R.duration : g(R), Y = R === void 0 ? this._defaultValue : d(R) ? R.values[R.values.length - 1] : R.value, ee = u(I) ? v(b, $, Y, I) : k(b, $, Y, I), W = u(I) ? o(ee, b, this._currenTime) : s(ee, b, this._currenTime);
                this._automationEvents.push(W);
              }
              if (R !== void 0 && _(R) && this._automationEvents.push(i(this.getValue(b), b)), R !== void 0 && d(R) && R.startTime + R.duration > b) {
                var ie = b - R.startTime;
                this._automationEvents[this._automationEvents.length - 1] = a(C(R.values, R.duration, ie), R.startTime, ie);
              }
            }
          } else {
            var ge = this._automationEvents.findIndex(function(ot) {
              return g(ot) > b;
            }), G = ge === -1 ? this._automationEvents[this._automationEvents.length - 1] : this._automationEvents[ge - 1];
            if (G !== void 0 && d(G) && g(G) + G.duration > b) return false;
            var Ut = u(S) ? o(S.value, S.endTime, this._currenTime) : c(S) ? s(S.value, b, this._currenTime) : S;
            if (ge === -1) this._automationEvents.push(Ut);
            else {
              if (d(S) && b + S.duration > g(this._automationEvents[ge])) return false;
              this._automationEvents.splice(ge, 0, Ut);
            }
          }
          return true;
        } }, { key: "flush", value: function(S) {
          var b = this._automationEvents.findIndex(function(R) {
            return g(R) > S;
          });
          if (b > 1) {
            var M = this._automationEvents.slice(b - 1), I = M[0];
            _(I) && M.unshift(i(m(this._automationEvents, b - 2, I.startTime, this._defaultValue), I.startTime)), this._automationEvents = M;
          }
        } }, { key: "getValue", value: function(S) {
          if (this._automationEvents.length === 0) return this._defaultValue;
          var b = this._automationEvents.findIndex(function(ot) {
            return g(ot) > S;
          }), M = this._automationEvents[b], I = (b === -1 ? this._automationEvents.length : b) - 1, R = this._automationEvents[I];
          if (R !== void 0 && _(R) && (M === void 0 || !h(M) || M.insertTime > S)) return l(S, m(this._automationEvents, I - 1, R.startTime, this._defaultValue), R);
          if (R !== void 0 && p(R) && (M === void 0 || !h(M))) return R.value;
          if (R !== void 0 && d(R) && (M === void 0 || !h(M) || R.startTime + R.duration > S)) return S < R.startTime + R.duration ? A(S, R) : R.values[R.values.length - 1];
          if (R !== void 0 && h(R) && (M === void 0 || !h(M))) return R.value;
          if (M !== void 0 && u(M)) {
            var $ = y(this._automationEvents, I, R, M, this._defaultValue), Y = e($, 2), ee = Y[0], W = Y[1];
            return v(S, ee, W, M);
          }
          if (M !== void 0 && c(M)) {
            var ie = y(this._automationEvents, I, R, M, this._defaultValue), ge = e(ie, 2), G = ge[0], Ut = ge[1];
            return k(S, G, Ut, M);
          }
          return this._defaultValue;
        } }]);
      })(), E = function(N) {
        return { cancelTime: N, type: "cancelAndHold" };
      }, D = function(N) {
        return { cancelTime: N, type: "cancelScheduledValues" };
      }, F = function(N, S) {
        return { endTime: S, type: "exponentialRampToValue", value: N };
      }, q = function(N, S) {
        return { endTime: S, type: "linearRampToValue", value: N };
      }, j = function(N, S, b) {
        return { startTime: S, target: N, timeConstant: b, type: "setTarget" };
      };
      t.AutomationEventList = x, t.createCancelAndHoldAutomationEvent = E, t.createCancelScheduledValuesAutomationEvent = D, t.createExponentialRampToValueAutomationEvent = F, t.createLinearRampToValueAutomationEvent = q, t.createSetTargetAutomationEvent = j, t.createSetValueAutomationEvent = i, t.createSetValueCurveAutomationEvent = a;
    }));
  });
  var ue = Gi(lu()), bv = Gi(Km());
  var xi = "15.1.22";
  var Et = Gi(kh());
  var fg = () => new DOMException("", "AbortError");
  var dg = (t) => (e, r, [n, o, s], i) => {
    t(e[o], [r, n, s], (a) => a[0] === r && a[1] === n, i);
  };
  var mg = (t) => (e, r, n) => {
    let o = [];
    for (let s = 0; s < n.numberOfInputs; s += 1) o.push(/* @__PURE__ */ new Set());
    t.set(e, { activeInputs: o, outputs: /* @__PURE__ */ new Set(), passiveInputs: /* @__PURE__ */ new WeakMap(), renderer: r });
  };
  var gg = (t) => (e, r) => {
    t.set(e, { activeInputs: /* @__PURE__ */ new Set(), passiveInputs: /* @__PURE__ */ new WeakMap(), renderer: r });
  };
  var Er = /* @__PURE__ */ new WeakSet(), ml = /* @__PURE__ */ new WeakMap(), Uo = /* @__PURE__ */ new WeakMap(), gl = /* @__PURE__ */ new WeakMap(), Ei = /* @__PURE__ */ new WeakMap(), Go = /* @__PURE__ */ new WeakMap(), _l = /* @__PURE__ */ new WeakMap(), bi = /* @__PURE__ */ new WeakMap(), Di = /* @__PURE__ */ new WeakMap(), Mi = /* @__PURE__ */ new WeakMap();
  var _g = { construct() {
    return _g;
  } }, xg = (t) => {
    try {
      let e = new Proxy(t, _g);
      new e();
    } catch {
      return false;
    }
    return true;
  };
  var yg = /^import(?:(?:[\s]+[\w]+|(?:[\s]+[\w]+[\s]*,)?[\s]*\{[\s]*[\w]+(?:[\s]+as[\s]+[\w]+)?(?:[\s]*,[\s]*[\w]+(?:[\s]+as[\s]+[\w]+)?)*[\s]*}|(?:[\s]+[\w]+[\s]*,)?[\s]*\*[\s]+as[\s]+[\w]+)[\s]+from)?(?:[\s]*)("([^"\\]|\\.)+"|'([^'\\]|\\.)+')(?:[\s]*);?/, Ch = (t, e) => {
    let r = [], n = t.replace(/^[\s]+/, ""), o = n.match(yg);
    for (; o !== null; ) {
      let s = o[1].slice(1, -1), i = o[0].replace(/([\s]+)?;?$/, "").replace(s, new URL(s, e).toString());
      r.push(i), n = n.slice(o[0].length).replace(/^[\s]+/, ""), o = n.match(yg);
    }
    return [r.join(";"), n];
  };
  var vg = (t) => {
    if (t !== void 0 && !Array.isArray(t)) throw new TypeError("The parameterDescriptors property of given value for processorCtor is not an array.");
  }, wg = (t) => {
    if (!xg(t)) throw new TypeError("The given value for processorCtor should be a constructor.");
    if (t.prototype === null || typeof t.prototype != "object") throw new TypeError("The given value for processorCtor should have a prototype.");
  }, Sg = (t, e, r, n, o, s, i, a, l, u, c, h, p) => {
    let d = 0;
    return (m, y, T = { credentials: "omit" }) => {
      let f = c.get(m);
      if (f !== void 0 && f.has(y)) return Promise.resolve();
      let g = u.get(m);
      if (g !== void 0) {
        let w = g.get(y);
        if (w !== void 0) return w;
      }
      let v = s(m), k = v.audioWorklet === void 0 ? o(y).then(([w, A]) => {
        let [C, _] = Ch(w, A), x = `${C};((a,b)=>{(a[b]=a[b]||[]).push((AudioWorkletProcessor,global,registerProcessor,sampleRate,self,window)=>{${_}
})})(window,'_AWGS')`;
        return r(x);
      }).then(() => {
        let w = p._AWGS.pop();
        if (w === void 0) throw new SyntaxError();
        n(v.currentTime, v.sampleRate, () => w(class {
        }, void 0, (A, C) => {
          if (A.trim() === "") throw e();
          let _ = Di.get(v);
          if (_ !== void 0) {
            if (_.has(A)) throw e();
            wg(C), vg(C.parameterDescriptors), _.set(A, C);
          } else wg(C), vg(C.parameterDescriptors), Di.set(v, /* @__PURE__ */ new Map([[A, C]]));
        }, v.sampleRate, void 0, void 0));
      }) : Promise.all([o(y), Promise.resolve(t(h, h))]).then(([[w, A], C]) => {
        let _ = d + 1;
        d = _;
        let [x, E] = Ch(w, A), j = `${x};((AudioWorkletProcessor,registerProcessor)=>{${E}
})(${C ? "AudioWorkletProcessor" : "class extends AudioWorkletProcessor {__b=new WeakSet();constructor(){super();(p=>p.postMessage=(q=>(m,t)=>q.call(p,m,t?t.filter(u=>!this.__b.has(u)):t))(p.postMessage))(this.port)}}"},(n,p)=>registerProcessor(n,class extends p{${C ? "" : "__c = (a) => a.forEach(e=>this.__b.add(e.buffer));"}process(i,o,p){${C ? "" : "i.forEach(this.__c);o.forEach(this.__c);this.__c(Object.values(p));"}return super.process(i.map(j=>j.some(k=>k.length===0)?[]:j),o,p)}}));registerProcessor('__sac${_}',class extends AudioWorkletProcessor{process(){return !1}})`, L = new Blob([j], { type: "application/javascript; charset=utf-8" }), N = URL.createObjectURL(L);
        return v.audioWorklet.addModule(N, T).then(() => {
          if (a(v)) return v;
          let S = i(v);
          return S.audioWorklet.addModule(N, T).then(() => S);
        }).then((S) => {
          if (l === null) throw new SyntaxError();
          try {
            new l(S, `__sac${_}`);
          } catch {
            throw new SyntaxError();
          }
        }).finally(() => URL.revokeObjectURL(N));
      });
      return g === void 0 ? u.set(m, /* @__PURE__ */ new Map([[y, k]])) : g.set(y, k), k.then(() => {
        let w = c.get(m);
        w === void 0 ? c.set(m, /* @__PURE__ */ new Set([y])) : w.add(y);
      }).finally(() => {
        let w = u.get(m);
        w !== void 0 && w.delete(y);
      }), k;
    };
  };
  var qe = (t, e) => {
    let r = t.get(e);
    if (r === void 0) throw new Error("A value with the given key could not be found.");
    return r;
  };
  var On = (t, e) => {
    let r = Array.from(t).filter(e);
    if (r.length > 1) throw Error("More than one element was found.");
    if (r.length === 0) throw Error("No element was found.");
    let [n] = r;
    return t.delete(n), n;
  };
  var xl = (t, e, r, n) => {
    let o = qe(t, e), s = On(o, (i) => i[0] === r && i[1] === n);
    return o.size === 0 && t.delete(e), s;
  };
  var br = (t) => qe(_l, t);
  var fr = (t) => {
    if (Er.has(t)) throw new Error("The AudioNode is already stored.");
    Er.add(t), br(t).forEach((e) => e(true));
  };
  var yl = (t) => "port" in t;
  var Dr = (t) => {
    if (!Er.has(t)) throw new Error("The AudioNode is not stored.");
    Er.delete(t), br(t).forEach((e) => e(false));
  };
  var Ri = (t, e) => {
    !yl(t) && e.every((r) => r.size === 0) && Dr(t);
  };
  var Tg = (t, e, r, n, o, s, i, a, l, u, c, h, p) => {
    let d = /* @__PURE__ */ new WeakMap();
    return (m, y, T, f, g) => {
      let { activeInputs: v, passiveInputs: k } = s(y), { outputs: w } = s(m), A = a(m), C = (_) => {
        let x = l(y), E = l(m);
        if (_) {
          let D = xl(k, m, T, f);
          t(v, m, D, false), !g && !h(m) && r(E, x, T, f), p(y) && fr(y);
        } else {
          let D = n(v, m, T, f);
          e(k, f, D, false), !g && !h(m) && o(E, x, T, f);
          let F = i(y);
          if (F === 0) c(y) && Ri(y, v);
          else {
            let q = d.get(y);
            q !== void 0 && clearTimeout(q), d.set(y, setTimeout(() => {
              c(y) && Ri(y, v);
            }, F * 1e3));
          }
        }
      };
      return u(w, [y, T, f], (_) => _[0] === y && _[1] === T && _[2] === f, true) ? (A.add(C), c(m) ? t(v, m, [T, f, C], true) : e(k, f, [m, T, C], true), true) : false;
    };
  };
  var Ag = (t) => (e, r, [n, o, s], i) => {
    let a = e.get(n);
    a === void 0 ? e.set(n, /* @__PURE__ */ new Set([[o, r, s]])) : t(a, [o, r, s], (l) => l[0] === o && l[1] === r, i);
  };
  var kg = (t) => (e, r) => {
    let n = t(e, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "discrete", gain: 0 });
    r.connect(n).connect(e.destination);
    let o = () => {
      r.removeEventListener("ended", o), r.disconnect(n), n.disconnect();
    };
    r.addEventListener("ended", o);
  };
  var Cg = (t) => (e, r) => {
    t(e).add(r);
  };
  var w1 = { channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers", fftSize: 2048, maxDecibels: -30, minDecibels: -100, smoothingTimeConstant: 0.8 }, Ng = (t, e, r, n, o, s) => class extends t {
    constructor(a, l) {
      let u = o(a), c = { ...w1, ...l }, h = n(u, c), p = s(u) ? e() : null;
      super(a, false, h, p), this._nativeAnalyserNode = h;
    }
    get fftSize() {
      return this._nativeAnalyserNode.fftSize;
    }
    set fftSize(a) {
      this._nativeAnalyserNode.fftSize = a;
    }
    get frequencyBinCount() {
      return this._nativeAnalyserNode.frequencyBinCount;
    }
    get maxDecibels() {
      return this._nativeAnalyserNode.maxDecibels;
    }
    set maxDecibels(a) {
      let l = this._nativeAnalyserNode.maxDecibels;
      if (this._nativeAnalyserNode.maxDecibels = a, !(a > this._nativeAnalyserNode.minDecibels)) throw this._nativeAnalyserNode.maxDecibels = l, r();
    }
    get minDecibels() {
      return this._nativeAnalyserNode.minDecibels;
    }
    set minDecibels(a) {
      let l = this._nativeAnalyserNode.minDecibels;
      if (this._nativeAnalyserNode.minDecibels = a, !(this._nativeAnalyserNode.maxDecibels > a)) throw this._nativeAnalyserNode.minDecibels = l, r();
    }
    get smoothingTimeConstant() {
      return this._nativeAnalyserNode.smoothingTimeConstant;
    }
    set smoothingTimeConstant(a) {
      this._nativeAnalyserNode.smoothingTimeConstant = a;
    }
    getByteFrequencyData(a) {
      this._nativeAnalyserNode.getByteFrequencyData(a);
    }
    getByteTimeDomainData(a) {
      this._nativeAnalyserNode.getByteTimeDomainData(a);
    }
    getFloatFrequencyData(a) {
      this._nativeAnalyserNode.getFloatFrequencyData(a);
    }
    getFloatTimeDomainData(a) {
      this._nativeAnalyserNode.getFloatTimeDomainData(a);
    }
  };
  var ae = (t, e) => t.context === e;
  var Og = (t, e, r) => () => {
    let n = /* @__PURE__ */ new WeakMap(), o = async (s, i) => {
      let a = e(s);
      if (!ae(a, i)) {
        let u = { channelCount: a.channelCount, channelCountMode: a.channelCountMode, channelInterpretation: a.channelInterpretation, fftSize: a.fftSize, maxDecibels: a.maxDecibels, minDecibels: a.minDecibels, smoothingTimeConstant: a.smoothingTimeConstant };
        a = t(i, u);
      }
      return n.set(i, a), await r(s, i, a), a;
    };
    return { render(s, i) {
      let a = n.get(i);
      return a !== void 0 ? Promise.resolve(a) : o(s, i);
    } };
  };
  var Qo = (t) => {
    try {
      t.copyToChannel(new Float32Array(1), 0, -1);
    } catch {
      return false;
    }
    return true;
  };
  var Jt = () => new DOMException("", "IndexSizeError");
  var Ho = (t) => {
    t.getChannelData = /* @__PURE__ */ ((e) => (r) => {
      try {
        return e.call(t, r);
      } catch (n) {
        throw n.code === 12 ? Jt() : n;
      }
    })(t.getChannelData);
  };
  var S1 = { numberOfChannels: 1 }, Eg = (t, e, r, n, o, s, i, a) => {
    let l = null;
    return class bg {
      constructor(c) {
        if (o === null) throw new Error("Missing the native OfflineAudioContext constructor.");
        let { length: h, numberOfChannels: p, sampleRate: d } = { ...S1, ...c };
        l === null && (l = new o(1, 1, 44100));
        let m = n !== null && e(s, s) ? new n({ length: h, numberOfChannels: p, sampleRate: d }) : l.createBuffer(p, h, d);
        if (m.numberOfChannels === 0) throw r();
        return typeof m.copyFromChannel != "function" ? (i(m), Ho(m)) : e(Qo, () => Qo(m)) || a(m), t.add(m), m;
      }
      static [Symbol.hasInstance](c) {
        return c !== null && typeof c == "object" && Object.getPrototypeOf(c) === bg.prototype || t.has(c);
      }
    };
  };
  var Re = -34028234663852886e22, De = -Re;
  var _t = (t) => Er.has(t);
  var T1 = { buffer: null, channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers", loop: false, loopEnd: 0, loopStart: 0, playbackRate: 1 }, Dg = (t, e, r, n, o, s, i, a) => class extends t {
    constructor(u, c) {
      let h = s(u), p = { ...T1, ...c }, d = o(h, p), m = i(h), y = m ? e() : null;
      super(u, false, d, y), this._audioBufferSourceNodeRenderer = y, this._isBufferNullified = false, this._isBufferSet = p.buffer !== null, this._nativeAudioBufferSourceNode = d, this._onended = null, this._playbackRate = r(this, m, d.playbackRate, De, Re);
    }
    get buffer() {
      return this._isBufferNullified ? null : this._nativeAudioBufferSourceNode.buffer;
    }
    set buffer(u) {
      if (this._nativeAudioBufferSourceNode.buffer = u, u !== null) {
        if (this._isBufferSet) throw n();
        this._isBufferSet = true;
      }
    }
    get loop() {
      return this._nativeAudioBufferSourceNode.loop;
    }
    set loop(u) {
      this._nativeAudioBufferSourceNode.loop = u;
    }
    get loopEnd() {
      return this._nativeAudioBufferSourceNode.loopEnd;
    }
    set loopEnd(u) {
      this._nativeAudioBufferSourceNode.loopEnd = u;
    }
    get loopStart() {
      return this._nativeAudioBufferSourceNode.loopStart;
    }
    set loopStart(u) {
      this._nativeAudioBufferSourceNode.loopStart = u;
    }
    get onended() {
      return this._onended;
    }
    set onended(u) {
      let c = typeof u == "function" ? a(this, u) : null;
      this._nativeAudioBufferSourceNode.onended = c;
      let h = this._nativeAudioBufferSourceNode.onended;
      this._onended = h !== null && h === c ? u : h;
    }
    get playbackRate() {
      return this._playbackRate;
    }
    start(u = 0, c = 0, h) {
      if (this._nativeAudioBufferSourceNode.start(u, c, h), this._audioBufferSourceNodeRenderer !== null && (this._audioBufferSourceNodeRenderer.start = h === void 0 ? [u, c] : [u, c, h]), this.context.state !== "closed") {
        fr(this);
        let p = () => {
          this._nativeAudioBufferSourceNode.removeEventListener("ended", p), _t(this) && Dr(this);
        };
        this._nativeAudioBufferSourceNode.addEventListener("ended", p);
      }
    }
    stop(u = 0) {
      this._nativeAudioBufferSourceNode.stop(u), this._audioBufferSourceNodeRenderer !== null && (this._audioBufferSourceNodeRenderer.stop = u);
    }
  };
  var Mg = (t, e, r, n, o) => () => {
    let s = /* @__PURE__ */ new WeakMap(), i = null, a = null, l = async (u, c) => {
      let h = r(u), p = ae(h, c);
      if (!p) {
        let d = { buffer: h.buffer, channelCount: h.channelCount, channelCountMode: h.channelCountMode, channelInterpretation: h.channelInterpretation, loop: h.loop, loopEnd: h.loopEnd, loopStart: h.loopStart, playbackRate: h.playbackRate.value };
        h = e(c, d), i !== null && h.start(...i), a !== null && h.stop(a);
      }
      return s.set(c, h), p ? await t(c, u.playbackRate, h.playbackRate) : await n(c, u.playbackRate, h.playbackRate), await o(u, c, h), h;
    };
    return { set start(u) {
      i = u;
    }, set stop(u) {
      a = u;
    }, render(u, c) {
      let h = s.get(c);
      return h !== void 0 ? Promise.resolve(h) : l(u, c);
    } };
  };
  var Rg = (t) => "playbackRate" in t;
  var Fg = (t) => "frequency" in t && "gain" in t;
  var Ig = (t) => "offset" in t;
  var Pg = (t) => !("frequency" in t) && "gain" in t;
  var Vg = (t) => "detune" in t && "frequency" in t && !("gain" in t);
  var Lg = (t) => "pan" in t;
  var He = (t) => qe(ml, t);
  var En = (t) => qe(gl, t);
  var vl = (t, e) => {
    let { activeInputs: r } = He(t);
    r.forEach((o) => o.forEach(([s]) => {
      e.includes(t) || vl(s, [...e, t]);
    }));
    let n = Rg(t) ? [t.playbackRate] : yl(t) ? Array.from(t.parameters.values()) : Fg(t) ? [t.Q, t.detune, t.frequency, t.gain] : Ig(t) ? [t.offset] : Pg(t) ? [t.gain] : Vg(t) ? [t.detune, t.frequency] : Lg(t) ? [t.pan] : [];
    for (let o of n) {
      let s = En(o);
      s !== void 0 && s.activeInputs.forEach(([i]) => vl(i, e));
    }
    _t(t) && Dr(t);
  };
  var bn = (t) => {
    vl(t.destination, []);
  };
  var wl = (t) => t === void 0 || typeof t == "number" || typeof t == "string" && (t === "balanced" || t === "interactive" || t === "playback");
  var qg = (t, e, r, n, o, s, i, a, l) => class extends t {
    constructor(c = {}) {
      if (l === null) throw new Error("Missing the native AudioContext constructor.");
      let h;
      try {
        h = new l(c);
      } catch (m) {
        throw m.code === 12 && m.message === "sampleRate is not in range" ? r() : m;
      }
      if (h === null) throw n();
      if (!wl(c.latencyHint)) throw new TypeError(`The provided value '${c.latencyHint}' is not a valid enum value of type AudioContextLatencyCategory.`);
      if (c.sampleRate !== void 0 && h.sampleRate !== c.sampleRate) throw r();
      super(h, 2);
      let { latencyHint: p } = c, { sampleRate: d } = h;
      if (this._baseLatency = typeof h.baseLatency == "number" ? h.baseLatency : p === "balanced" ? 512 / d : p === "interactive" || p === void 0 ? 256 / d : p === "playback" ? 1024 / d : Math.max(2, Math.min(128, Math.round(p * d / 128))) * 128 / d, this._nativeAudioContext = h, l.name === "webkitAudioContext" ? (this._nativeGainNode = h.createGain(), this._nativeOscillatorNode = h.createOscillator(), this._nativeGainNode.gain.value = 1e-37, this._nativeOscillatorNode.connect(this._nativeGainNode).connect(h.destination), this._nativeOscillatorNode.start()) : (this._nativeGainNode = null, this._nativeOscillatorNode = null), this._state = null, h.state === "running") {
        this._state = "suspended";
        let m = () => {
          this._state === "suspended" && (this._state = null), h.removeEventListener("statechange", m);
        };
        h.addEventListener("statechange", m);
      }
    }
    get baseLatency() {
      return this._baseLatency;
    }
    get state() {
      return this._state !== null ? this._state : this._nativeAudioContext.state;
    }
    close() {
      return this.state === "closed" ? this._nativeAudioContext.close().then(() => {
        throw e();
      }) : (this._state === "suspended" && (this._state = null), this._nativeAudioContext.close().then(() => {
        this._nativeGainNode !== null && this._nativeOscillatorNode !== null && (this._nativeOscillatorNode.stop(), this._nativeGainNode.disconnect(), this._nativeOscillatorNode.disconnect()), bn(this);
      }));
    }
    createMediaElementSource(c) {
      return new o(this, { mediaElement: c });
    }
    createMediaStreamDestination() {
      return new s(this);
    }
    createMediaStreamSource(c) {
      return new i(this, { mediaStream: c });
    }
    createMediaStreamTrackSource(c) {
      return new a(this, { mediaStreamTrack: c });
    }
    resume() {
      return this._state === "suspended" ? new Promise((c, h) => {
        let p = () => {
          this._nativeAudioContext.removeEventListener("statechange", p), this._nativeAudioContext.state === "running" ? c() : this.resume().then(c, h);
        };
        this._nativeAudioContext.addEventListener("statechange", p);
      }) : this._nativeAudioContext.resume().catch((c) => {
        throw c === void 0 || c.code === 15 ? e() : c;
      });
    }
    suspend() {
      return this._nativeAudioContext.suspend().catch((c) => {
        throw c === void 0 ? e() : c;
      });
    }
  };
  var jg = (t, e, r, n, o, s, i, a) => class extends t {
    constructor(u, c) {
      let h = s(u), p = i(h), d = o(h, c, p), m = p ? e(a) : null;
      super(u, false, d, m), this._isNodeOfNativeOfflineAudioContext = p, this._nativeAudioDestinationNode = d;
    }
    get channelCount() {
      return this._nativeAudioDestinationNode.channelCount;
    }
    set channelCount(u) {
      if (this._isNodeOfNativeOfflineAudioContext) throw n();
      if (u > this._nativeAudioDestinationNode.maxChannelCount) throw r();
      this._nativeAudioDestinationNode.channelCount = u;
    }
    get channelCountMode() {
      return this._nativeAudioDestinationNode.channelCountMode;
    }
    set channelCountMode(u) {
      if (this._isNodeOfNativeOfflineAudioContext) throw n();
      this._nativeAudioDestinationNode.channelCountMode = u;
    }
    get maxChannelCount() {
      return this._nativeAudioDestinationNode.maxChannelCount;
    }
  };
  var zg = (t) => {
    let e = /* @__PURE__ */ new WeakMap(), r = async (n, o) => {
      let s = o.destination;
      return e.set(o, s), await t(n, o, s), s;
    };
    return { render(n, o) {
      let s = e.get(o);
      return s !== void 0 ? Promise.resolve(s) : r(n, o);
    } };
  };
  var Wg = (t, e, r, n, o, s, i, a) => (l, u) => {
    let c = u.listener, h = () => {
      let w = new Float32Array(1), A = e(u, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers", numberOfInputs: 9 }), C = i(u), _ = false, x = [0, 0, -1, 0, 1, 0], E = [0, 0, 0], D = () => {
        if (_) return;
        _ = true;
        let L = n(u, 256, 9, 0);
        L.onaudioprocess = ({ inputBuffer: N }) => {
          let S = [s(N, w, 0), s(N, w, 1), s(N, w, 2), s(N, w, 3), s(N, w, 4), s(N, w, 5)];
          S.some((M, I) => M !== x[I]) && (c.setOrientation(...S), x = S);
          let b = [s(N, w, 6), s(N, w, 7), s(N, w, 8)];
          b.some((M, I) => M !== E[I]) && (c.setPosition(...b), E = b);
        }, A.connect(L);
      }, F = (L) => (N) => {
        N !== x[L] && (x[L] = N, c.setOrientation(...x));
      }, q = (L) => (N) => {
        N !== E[L] && (E[L] = N, c.setPosition(...E));
      }, j = (L, N, S) => {
        let b = r(u, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "discrete", offset: N });
        b.connect(A, 0, L), b.start(), Object.defineProperty(b.offset, "defaultValue", { get() {
          return N;
        } });
        let M = t({ context: l }, C, b.offset, De, Re);
        return a(M, "value", (I) => () => I.call(M), (I) => (R) => {
          try {
            I.call(M, R);
          } catch ($) {
            if ($.code !== 9) throw $;
          }
          D(), C && S(R);
        }), M.cancelAndHoldAtTime = /* @__PURE__ */ ((I) => C ? () => {
          throw o();
        } : (...R) => {
          let $ = I.apply(M, R);
          return D(), $;
        })(M.cancelAndHoldAtTime), M.cancelScheduledValues = /* @__PURE__ */ ((I) => C ? () => {
          throw o();
        } : (...R) => {
          let $ = I.apply(M, R);
          return D(), $;
        })(M.cancelScheduledValues), M.exponentialRampToValueAtTime = /* @__PURE__ */ ((I) => C ? () => {
          throw o();
        } : (...R) => {
          let $ = I.apply(M, R);
          return D(), $;
        })(M.exponentialRampToValueAtTime), M.linearRampToValueAtTime = /* @__PURE__ */ ((I) => C ? () => {
          throw o();
        } : (...R) => {
          let $ = I.apply(M, R);
          return D(), $;
        })(M.linearRampToValueAtTime), M.setTargetAtTime = /* @__PURE__ */ ((I) => C ? () => {
          throw o();
        } : (...R) => {
          let $ = I.apply(M, R);
          return D(), $;
        })(M.setTargetAtTime), M.setValueAtTime = /* @__PURE__ */ ((I) => C ? () => {
          throw o();
        } : (...R) => {
          let $ = I.apply(M, R);
          return D(), $;
        })(M.setValueAtTime), M.setValueCurveAtTime = /* @__PURE__ */ ((I) => C ? () => {
          throw o();
        } : (...R) => {
          let $ = I.apply(M, R);
          return D(), $;
        })(M.setValueCurveAtTime), M;
      };
      return { forwardX: j(0, 0, F(0)), forwardY: j(1, 0, F(1)), forwardZ: j(2, -1, F(2)), positionX: j(6, 0, q(0)), positionY: j(7, 0, q(1)), positionZ: j(8, 0, q(2)), upX: j(3, 0, F(3)), upY: j(4, 1, F(4)), upZ: j(5, 0, F(5)) };
    }, { forwardX: p, forwardY: d, forwardZ: m, positionX: y, positionY: T, positionZ: f, upX: g, upY: v, upZ: k } = c.forwardX === void 0 ? h() : c;
    return { get forwardX() {
      return p;
    }, get forwardY() {
      return d;
    }, get forwardZ() {
      return m;
    }, get positionX() {
      return y;
    }, get positionY() {
      return T;
    }, get positionZ() {
      return f;
    }, get upX() {
      return g;
    }, get upY() {
      return v;
    }, get upZ() {
      return k;
    } };
  };
  var Jn = (t) => "context" in t;
  var Dn = (t) => Jn(t[0]);
  var dr = (t, e, r, n) => {
    for (let o of t) if (r(o)) {
      if (n) return false;
      throw Error("The set contains at least one similar element.");
    }
    return t.add(e), true;
  };
  var Nh = (t, e, [r, n], o) => {
    dr(t, [e, r, n], (s) => s[0] === e && s[1] === r, o);
  };
  var Oh = (t, [e, r, n], o) => {
    let s = t.get(e);
    s === void 0 ? t.set(e, /* @__PURE__ */ new Set([[r, n]])) : dr(s, [r, n], (i) => i[0] === r, o);
  };
  var er = (t) => "inputs" in t;
  var $o = (t, e, r, n) => {
    if (er(e)) {
      let o = e.inputs[n];
      return t.connect(o, r, 0), [o, r, 0];
    }
    return t.connect(e, r, n), [e, r, n];
  };
  var Eh = (t, e, r) => {
    for (let n of t) if (n[0] === e && n[1] === r) return t.delete(n), n;
    return null;
  };
  var Bg = (t, e, r) => On(t, (n) => n[0] === e && n[1] === r);
  var bh = (t, e) => {
    if (!br(t).delete(e)) throw new Error("Missing the expected event listener.");
  };
  var Dh = (t, e, r) => {
    let n = qe(t, e), o = On(n, (s) => s[0] === r);
    return n.size === 0 && t.delete(e), o;
  };
  var Yo = (t, e, r, n) => {
    er(e) ? t.disconnect(e.inputs[n], r, 0) : t.disconnect(e, r, n);
  };
  var de = (t) => qe(Uo, t);
  var eo = (t) => qe(Ei, t);
  var Xr = (t) => bi.has(t);
  var Xo = (t) => !Er.has(t);
  var Mh = (t, e) => new Promise((r) => {
    if (e !== null) r(true);
    else {
      let n = t.createScriptProcessor(256, 1, 1), o = t.createGain(), s = t.createBuffer(1, 2, 44100), i = s.getChannelData(0);
      i[0] = 1, i[1] = 1;
      let a = t.createBufferSource();
      a.buffer = s, a.loop = true, a.connect(n).connect(t.destination), a.connect(o), a.disconnect(o), n.onaudioprocess = (l) => {
        let u = l.inputBuffer.getChannelData(0);
        Array.prototype.some.call(u, (c) => c === 1) ? r(true) : r(false), a.stop(), n.onaudioprocess = null, a.disconnect(n), n.disconnect(t.destination);
      }, a.start();
    }
  });
  var Sl = (t, e) => {
    let r = /* @__PURE__ */ new Map();
    for (let n of t) for (let o of n) {
      let s = r.get(o);
      r.set(o, s === void 0 ? 1 : s + 1);
    }
    r.forEach((n, o) => e(o, n));
  };
  var to = (t) => "context" in t;
  var Ug = (t) => {
    let e = /* @__PURE__ */ new Map();
    t.connect = /* @__PURE__ */ ((r) => (n, o = 0, s = 0) => {
      let i = to(n) ? r(n, o, s) : r(n, o), a = e.get(n);
      return a === void 0 ? e.set(n, [{ input: s, output: o }]) : a.every((l) => l.input !== s || l.output !== o) && a.push({ input: s, output: o }), i;
    })(t.connect.bind(t)), t.disconnect = /* @__PURE__ */ ((r) => (n, o, s) => {
      if (r.apply(t), n === void 0) e.clear();
      else if (typeof n == "number") for (let [i, a] of e) {
        let l = a.filter((u) => u.output !== n);
        l.length === 0 ? e.delete(i) : e.set(i, l);
      }
      else if (e.has(n)) if (o === void 0) e.delete(n);
      else {
        let i = e.get(n);
        if (i !== void 0) {
          let a = i.filter((l) => l.output !== o && (l.input !== s || s === void 0));
          a.length === 0 ? e.delete(n) : e.set(n, a);
        }
      }
      for (let [i, a] of e) a.forEach((l) => {
        to(i) ? t.connect(i, l.output, l.input) : t.connect(i, l.output);
      });
    })(t.disconnect);
  };
  var A1 = (t, e, r, n) => {
    let { activeInputs: o, passiveInputs: s } = En(e), { outputs: i } = He(t), a = br(t), l = (u) => {
      let c = de(t), h = eo(e);
      if (u) {
        let p = Dh(s, t, r);
        Nh(o, t, p, false), !n && !Xr(t) && c.connect(h, r);
      } else {
        let p = Bg(o, t, r);
        Oh(s, p, false), !n && !Xr(t) && c.disconnect(h, r);
      }
    };
    return dr(i, [e, r], (u) => u[0] === e && u[1] === r, true) ? (a.add(l), _t(t) ? Nh(o, t, [r, l], true) : Oh(s, [t, r, l], true), true) : false;
  }, k1 = (t, e, r, n) => {
    let { activeInputs: o, passiveInputs: s } = He(e), i = Eh(o[n], t, r);
    return i === null ? [xl(s, t, r, n)[2], false] : [i[2], true];
  }, C1 = (t, e, r) => {
    let { activeInputs: n, passiveInputs: o } = En(e), s = Eh(n, t, r);
    return s === null ? [Dh(o, t, r)[1], false] : [s[2], true];
  }, Rh = (t, e, r, n, o) => {
    let [s, i] = k1(t, r, n, o);
    if (s !== null && (bh(t, s), i && !e && !Xr(t) && Yo(de(t), de(r), n, o)), _t(r)) {
      let { activeInputs: a } = He(r);
      Ri(r, a);
    }
  }, Fh = (t, e, r, n) => {
    let [o, s] = C1(t, r, n);
    o !== null && (bh(t, o), s && !e && !Xr(t) && de(t).disconnect(eo(r), n));
  }, N1 = (t, e) => {
    let r = He(t), n = [];
    for (let o of r.outputs) Dn(o) ? Rh(t, e, ...o) : Fh(t, e, ...o), n.push(o[0]);
    return r.outputs.clear(), n;
  }, O1 = (t, e, r) => {
    let n = He(t), o = [];
    for (let s of n.outputs) s[1] === r && (Dn(s) ? Rh(t, e, ...s) : Fh(t, e, ...s), o.push(s[0]), n.outputs.delete(s));
    return o;
  }, E1 = (t, e, r, n, o) => {
    let s = He(t);
    return Array.from(s.outputs).filter((i) => i[0] === r && (n === void 0 || i[1] === n) && (o === void 0 || i[2] === o)).map((i) => (Dn(i) ? Rh(t, e, ...i) : Fh(t, e, ...i), s.outputs.delete(i), i[0]));
  }, Gg = (t, e, r, n, o, s, i, a, l, u, c, h, p, d, m, y) => class extends u {
    constructor(f, g, v, k) {
      super(v), this._context = f, this._nativeAudioNode = v;
      let w = c(f);
      h(w) && r(Mh, () => Mh(w, y)) !== true && Ug(v), Uo.set(this, v), _l.set(this, /* @__PURE__ */ new Set()), f.state !== "closed" && g && fr(this), t(this, k, v);
    }
    get channelCount() {
      return this._nativeAudioNode.channelCount;
    }
    set channelCount(f) {
      this._nativeAudioNode.channelCount = f;
    }
    get channelCountMode() {
      return this._nativeAudioNode.channelCountMode;
    }
    set channelCountMode(f) {
      this._nativeAudioNode.channelCountMode = f;
    }
    get channelInterpretation() {
      return this._nativeAudioNode.channelInterpretation;
    }
    set channelInterpretation(f) {
      this._nativeAudioNode.channelInterpretation = f;
    }
    get context() {
      return this._context;
    }
    get numberOfInputs() {
      return this._nativeAudioNode.numberOfInputs;
    }
    get numberOfOutputs() {
      return this._nativeAudioNode.numberOfOutputs;
    }
    connect(f, g = 0, v = 0) {
      if (g < 0 || g >= this._nativeAudioNode.numberOfOutputs) throw o();
      let k = c(this._context), w = m(k);
      if (p(f) || d(f)) throw s();
      if (Jn(f)) {
        let _ = de(f);
        try {
          let E = $o(this._nativeAudioNode, _, g, v), D = Xo(this);
          (w || D) && this._nativeAudioNode.disconnect(...E), this.context.state !== "closed" && !D && Xo(f) && fr(f);
        } catch (E) {
          throw E.code === 12 ? s() : E;
        }
        if (e(this, f, g, v, w)) {
          let E = l([this], f);
          Sl(E, n(w));
        }
        return f;
      }
      let A = eo(f);
      if (A.name === "playbackRate" && A.maxValue === 1024) throw i();
      try {
        this._nativeAudioNode.connect(A, g), (w || Xo(this)) && this._nativeAudioNode.disconnect(A, g);
      } catch (_) {
        throw _.code === 12 ? s() : _;
      }
      if (A1(this, f, g, w)) {
        let _ = l([this], f);
        Sl(_, n(w));
      }
    }
    disconnect(f, g, v) {
      let k, w = c(this._context), A = m(w);
      if (f === void 0) k = N1(this, A);
      else if (typeof f == "number") {
        if (f < 0 || f >= this.numberOfOutputs) throw o();
        k = O1(this, A, f);
      } else {
        if (g !== void 0 && (g < 0 || g >= this.numberOfOutputs) || Jn(f) && v !== void 0 && (v < 0 || v >= f.numberOfInputs)) throw o();
        if (k = E1(this, A, f, g, v), k.length === 0) throw s();
      }
      for (let C of k) {
        let _ = l([this], C);
        Sl(_, a);
      }
    }
  };
  var Qg = Gi(kh()), Hg = (t, e, r, n, o, s, i, a, l, u, c, h, p) => (d, m, y, T = null, f = null) => {
    let g = y.value, v = new Qg.AutomationEventList(g), k = m ? n(v) : null, w = { get defaultValue() {
      return g;
    }, get maxValue() {
      return T === null ? y.maxValue : T;
    }, get minValue() {
      return f === null ? y.minValue : f;
    }, get value() {
      return y.value;
    }, set value(A) {
      y.value = A, w.setValueAtTime(A, d.context.currentTime);
    }, cancelAndHoldAtTime(A) {
      if (typeof y.cancelAndHoldAtTime == "function") k === null && v.flush(d.context.currentTime), v.add(o(A)), y.cancelAndHoldAtTime(A);
      else {
        let C = Array.from(v).pop();
        k === null && v.flush(d.context.currentTime), v.add(o(A));
        let _ = Array.from(v).pop();
        y.cancelScheduledValues(A), C !== _ && _ !== void 0 && (_.type === "exponentialRampToValue" ? y.exponentialRampToValueAtTime(_.value, _.endTime) : _.type === "linearRampToValue" ? y.linearRampToValueAtTime(_.value, _.endTime) : _.type === "setValue" ? y.setValueAtTime(_.value, _.startTime) : _.type === "setValueCurve" && y.setValueCurveAtTime(_.values, _.startTime, _.duration));
      }
      return w;
    }, cancelScheduledValues(A) {
      return k === null && v.flush(d.context.currentTime), v.add(s(A)), y.cancelScheduledValues(A), w;
    }, exponentialRampToValueAtTime(A, C) {
      if (A === 0) throw new RangeError();
      if (!Number.isFinite(C) || C < 0) throw new RangeError();
      let _ = d.context.currentTime;
      return k === null && v.flush(_), Array.from(v).length === 0 && (v.add(u(g, _)), y.setValueAtTime(g, _)), v.add(i(A, C)), y.exponentialRampToValueAtTime(A, C), w;
    }, linearRampToValueAtTime(A, C) {
      let _ = d.context.currentTime;
      return k === null && v.flush(_), Array.from(v).length === 0 && (v.add(u(g, _)), y.setValueAtTime(g, _)), v.add(a(A, C)), y.linearRampToValueAtTime(A, C), w;
    }, setTargetAtTime(A, C, _) {
      return k === null && v.flush(d.context.currentTime), v.add(l(A, C, _)), y.setTargetAtTime(A, C, _), w;
    }, setValueAtTime(A, C) {
      return k === null && v.flush(d.context.currentTime), v.add(u(A, C)), y.setValueAtTime(A, C), w;
    }, setValueCurveAtTime(A, C, _) {
      let x = A instanceof Float32Array ? A : new Float32Array(A);
      if (h !== null && h.name === "webkitAudioContext") {
        let E = C + _, D = d.context.sampleRate, F = Math.ceil(C * D), q = Math.floor(E * D), j = q - F, L = new Float32Array(j);
        for (let S = 0; S < j; S += 1) {
          let b = (x.length - 1) / _ * ((F + S) / D - C), M = Math.floor(b), I = Math.ceil(b);
          L[S] = M === I ? x[M] : (1 - (b - M)) * x[M] + (1 - (I - b)) * x[I];
        }
        k === null && v.flush(d.context.currentTime), v.add(c(L, C, _)), y.setValueCurveAtTime(L, C, _);
        let N = q / D;
        N < E && p(w, L[L.length - 1], N), p(w, x[x.length - 1], E);
      } else k === null && v.flush(d.context.currentTime), v.add(c(x, C, _)), y.setValueCurveAtTime(x, C, _);
      return w;
    } };
    return r.set(w, y), e.set(w, d), t(w, k), w;
  };
  var $g = (t) => ({ replay(e) {
    for (let r of t) if (r.type === "exponentialRampToValue") {
      let { endTime: n, value: o } = r;
      e.exponentialRampToValueAtTime(o, n);
    } else if (r.type === "linearRampToValue") {
      let { endTime: n, value: o } = r;
      e.linearRampToValueAtTime(o, n);
    } else if (r.type === "setTarget") {
      let { startTime: n, target: o, timeConstant: s } = r;
      e.setTargetAtTime(o, n, s);
    } else if (r.type === "setValue") {
      let { startTime: n, value: o } = r;
      e.setValueAtTime(o, n);
    } else if (r.type === "setValueCurve") {
      let { duration: n, startTime: o, values: s } = r;
      e.setValueCurveAtTime(s, o, n);
    } else throw new Error("Can't apply an unknown automation.");
  } });
  var Zo = class {
    constructor(e) {
      this._map = new Map(e);
    }
    get size() {
      return this._map.size;
    }
    entries() {
      return this._map.entries();
    }
    forEach(e, r = null) {
      return this._map.forEach((n, o) => e.call(r, n, o, this));
    }
    get(e) {
      return this._map.get(e);
    }
    has(e) {
      return this._map.has(e);
    }
    keys() {
      return this._map.keys();
    }
    values() {
      return this._map.values();
    }
  };
  var b1 = { channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers", numberOfInputs: 1, numberOfOutputs: 1, parameterData: {}, processorOptions: {} }, Yg = (t, e, r, n, o, s, i, a, l, u, c, h, p, d) => class extends e {
    constructor(y, T, f) {
      var g;
      let v = a(y), k = l(v), w = c({ ...b1, ...f });
      p(w);
      let A = Di.get(v), C = A?.get(T), _ = k || v.state !== "closed" ? v : (g = i(v)) !== null && g !== void 0 ? g : v, x = o(_, k ? null : y.baseLatency, u, T, C, w), E = k ? n(T, w, C) : null;
      super(y, true, x, E);
      let D = [];
      x.parameters.forEach((q, j) => {
        let L = r(this, k, q);
        D.push([j, L]);
      }), this._nativeAudioWorkletNode = x, this._onprocessorerror = null, this._parameters = new Zo(D), k && t(v, this);
      let { activeInputs: F } = s(this);
      h(x, F);
    }
    get onprocessorerror() {
      return this._onprocessorerror;
    }
    set onprocessorerror(y) {
      let T = typeof y == "function" ? d(this, y) : null;
      this._nativeAudioWorkletNode.onprocessorerror = T;
      let f = this._nativeAudioWorkletNode.onprocessorerror;
      this._onprocessorerror = f !== null && f === T ? y : f;
    }
    get parameters() {
      return this._parameters === null ? this._nativeAudioWorkletNode.parameters : this._parameters;
    }
    get port() {
      return this._nativeAudioWorkletNode.port;
    }
  };
  function Ko(t, e, r, n, o) {
    if (typeof t.copyFromChannel == "function") e[r].byteLength === 0 && (e[r] = new Float32Array(128)), t.copyFromChannel(e[r], n, o);
    else {
      let s = t.getChannelData(n);
      if (e[r].byteLength === 0) e[r] = s.slice(o, o + 128);
      else {
        let i = new Float32Array(s.buffer, o * Float32Array.BYTES_PER_ELEMENT, 128);
        e[r].set(i);
      }
    }
  }
  var Tl = (t, e, r, n, o) => {
    typeof t.copyToChannel == "function" ? e[r].byteLength !== 0 && t.copyToChannel(e[r], n, o) : e[r].byteLength !== 0 && t.getChannelData(n).set(e[r], o);
  };
  var Jo = (t, e) => {
    let r = [];
    for (let n = 0; n < t; n += 1) {
      let o = [], s = typeof e == "number" ? e : e[n];
      for (let i = 0; i < s; i += 1) o.push(new Float32Array(128));
      r.push(o);
    }
    return r;
  };
  var Xg = (t, e) => {
    let r = qe(Mi, t), n = de(e);
    return qe(r, n);
  };
  var D1 = async (t, e, r, n, o, s, i) => {
    let a = e === null ? Math.ceil(t.context.length / 128) * 128 : e.length, l = n.channelCount * n.numberOfInputs, u = o.reduce((T, f) => T + f, 0), c = u === 0 ? null : r.createBuffer(u, a, r.sampleRate);
    if (s === void 0) throw new Error("Missing the processor constructor.");
    let h = He(t), p = await Xg(r, t), d = Jo(n.numberOfInputs, n.channelCount), m = Jo(n.numberOfOutputs, o), y = Array.from(t.parameters.keys()).reduce((T, f) => ({ ...T, [f]: new Float32Array(128) }), {});
    for (let T = 0; T < a; T += 128) {
      if (n.numberOfInputs > 0 && e !== null) for (let f = 0; f < n.numberOfInputs; f += 1) for (let g = 0; g < n.channelCount; g += 1) Ko(e, d[f], g, g, T);
      s.parameterDescriptors !== void 0 && e !== null && s.parameterDescriptors.forEach(({ name: f }, g) => {
        Ko(e, y, f, l + g, T);
      });
      for (let f = 0; f < n.numberOfInputs; f += 1) for (let g = 0; g < o[f]; g += 1) m[f][g].byteLength === 0 && (m[f][g] = new Float32Array(128));
      try {
        let f = d.map((v, k) => h.activeInputs[k].size === 0 ? [] : v), g = i(T / r.sampleRate, r.sampleRate, () => p.process(f, m, y));
        if (c !== null) for (let v = 0, k = 0; v < n.numberOfOutputs; v += 1) {
          for (let w = 0; w < o[v]; w += 1) Tl(c, m[v], w, k + w, T);
          k += o[v];
        }
        if (!g) break;
      } catch (f) {
        t.dispatchEvent(new ErrorEvent("processorerror", { colno: f.colno, filename: f.filename, lineno: f.lineno, message: f.message }));
        break;
      }
    }
    return c;
  }, Zg = (t, e, r, n, o, s, i, a, l, u, c, h, p, d, m, y) => (T, f, g) => {
    let v = /* @__PURE__ */ new WeakMap(), k = null, w = async (A, C) => {
      let _ = c(A), x = null, E = ae(_, C), D = Array.isArray(f.outputChannelCount) ? f.outputChannelCount : Array.from(f.outputChannelCount);
      if (h === null) {
        let F = D.reduce((N, S) => N + S, 0), q = o(C, { channelCount: Math.max(1, F), channelCountMode: "explicit", channelInterpretation: "discrete", numberOfOutputs: Math.max(1, F) }), j = [];
        for (let N = 0; N < A.numberOfOutputs; N += 1) j.push(n(C, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers", numberOfInputs: D[N] }));
        let L = i(C, { channelCount: f.channelCount, channelCountMode: f.channelCountMode, channelInterpretation: f.channelInterpretation, gain: 1 });
        L.connect = e.bind(null, j), L.disconnect = l.bind(null, j), x = [q, j, L];
      } else E || (_ = new h(C, T));
      if (v.set(C, x === null ? _ : x[2]), x !== null) {
        if (k === null) {
          if (g === void 0) throw new Error("Missing the processor constructor.");
          if (p === null) throw new Error("Missing the native OfflineAudioContext constructor.");
          let S = A.channelCount * A.numberOfInputs, b = g.parameterDescriptors === void 0 ? 0 : g.parameterDescriptors.length, M = S + b;
          k = D1(A, M === 0 ? null : await (async () => {
            let R = new p(M, Math.ceil(A.context.length / 128) * 128, C.sampleRate), $ = [], Y = [];
            for (let ie = 0; ie < f.numberOfInputs; ie += 1) $.push(i(R, { channelCount: f.channelCount, channelCountMode: f.channelCountMode, channelInterpretation: f.channelInterpretation, gain: 1 })), Y.push(o(R, { channelCount: f.channelCount, channelCountMode: "explicit", channelInterpretation: "discrete", numberOfOutputs: f.channelCount }));
            let ee = await Promise.all(Array.from(A.parameters.values()).map(async (ie) => {
              let ge = s(R, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "discrete", offset: ie.value });
              return await d(R, ie, ge.offset), ge;
            })), W = n(R, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers", numberOfInputs: Math.max(1, S + b) });
            for (let ie = 0; ie < f.numberOfInputs; ie += 1) {
              $[ie].connect(Y[ie]);
              for (let ge = 0; ge < f.channelCount; ge += 1) Y[ie].connect(W, ge, ie * f.channelCount + ge);
            }
            for (let [ie, ge] of ee.entries()) ge.connect(W, 0, S + ie), ge.start(0);
            return W.connect(R.destination), await Promise.all($.map((ie) => m(A, R, ie))), y(R);
          })(), C, f, D, g, u);
        }
        let F = await k, q = r(C, { buffer: null, channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers", loop: false, loopEnd: 0, loopStart: 0, playbackRate: 1 }), [j, L, N] = x;
        F !== null && (q.buffer = F, q.start(0)), q.connect(j);
        for (let S = 0, b = 0; S < A.numberOfOutputs; S += 1) {
          let M = L[S];
          for (let I = 0; I < D[S]; I += 1) j.connect(M, b + I, I);
          b += D[S];
        }
        return N;
      }
      if (E) for (let [F, q] of A.parameters.entries()) await t(C, q, _.parameters.get(F));
      else for (let [F, q] of A.parameters.entries()) await d(C, q, _.parameters.get(F));
      return await m(A, C, _), _;
    };
    return { render(A, C) {
      a(C, A);
      let _ = v.get(C);
      return _ !== void 0 ? Promise.resolve(_) : w(A, C);
    } };
  };
  var Kg = (t, e, r, n, o, s, i, a, l, u, c, h, p, d, m, y, T, f, g, v) => class extends m {
    constructor(w, A) {
      super(w, A), this._nativeContext = w, this._audioWorklet = t === void 0 ? void 0 : { addModule: (C, _) => t(this, C, _) };
    }
    get audioWorklet() {
      return this._audioWorklet;
    }
    createAnalyser() {
      return new e(this);
    }
    createBiquadFilter() {
      return new o(this);
    }
    createBuffer(w, A, C) {
      return new r({ length: A, numberOfChannels: w, sampleRate: C });
    }
    createBufferSource() {
      return new n(this);
    }
    createChannelMerger(w = 6) {
      return new s(this, { numberOfInputs: w });
    }
    createChannelSplitter(w = 6) {
      return new i(this, { numberOfOutputs: w });
    }
    createConstantSource() {
      return new a(this);
    }
    createConvolver() {
      return new l(this);
    }
    createDelay(w = 1) {
      return new c(this, { maxDelayTime: w });
    }
    createDynamicsCompressor() {
      return new h(this);
    }
    createGain() {
      return new p(this);
    }
    createIIRFilter(w, A) {
      return new d(this, { feedback: A, feedforward: w });
    }
    createOscillator() {
      return new y(this);
    }
    createPanner() {
      return new T(this);
    }
    createPeriodicWave(w, A, C = { disableNormalization: false }) {
      return new f(this, { ...C, imag: A, real: w });
    }
    createStereoPanner() {
      return new g(this);
    }
    createWaveShaper() {
      return new v(this);
    }
    decodeAudioData(w, A, C) {
      return u(this._nativeContext, w).then((_) => (typeof A == "function" && A(_), _), (_) => {
        throw typeof C == "function" && C(_), _;
      });
    }
  };
  var M1 = { Q: 1, channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers", detune: 0, frequency: 350, gain: 0, type: "lowpass" }, Jg = (t, e, r, n, o, s, i, a) => class extends t {
    constructor(u, c) {
      let h = s(u), p = { ...M1, ...c }, d = o(h, p), m = i(h), y = m ? r() : null;
      super(u, false, d, y), this._Q = e(this, m, d.Q, De, Re), this._detune = e(this, m, d.detune, 1200 * Math.log2(De), -1200 * Math.log2(De)), this._frequency = e(this, m, d.frequency, u.sampleRate / 2, 0), this._gain = e(this, m, d.gain, 40 * Math.log10(De), Re), this._nativeBiquadFilterNode = d, a(this, 1);
    }
    get detune() {
      return this._detune;
    }
    get frequency() {
      return this._frequency;
    }
    get gain() {
      return this._gain;
    }
    get Q() {
      return this._Q;
    }
    get type() {
      return this._nativeBiquadFilterNode.type;
    }
    set type(u) {
      this._nativeBiquadFilterNode.type = u;
    }
    getFrequencyResponse(u, c, h) {
      try {
        this._nativeBiquadFilterNode.getFrequencyResponse(u, c, h);
      } catch (p) {
        throw p.code === 11 ? n() : p;
      }
      if (u.length !== c.length || c.length !== h.length) throw n();
    }
  };
  var e_ = (t, e, r, n, o) => () => {
    let s = /* @__PURE__ */ new WeakMap(), i = async (a, l) => {
      let u = r(a), c = ae(u, l);
      if (!c) {
        let h = { Q: u.Q.value, channelCount: u.channelCount, channelCountMode: u.channelCountMode, channelInterpretation: u.channelInterpretation, detune: u.detune.value, frequency: u.frequency.value, gain: u.gain.value, type: u.type };
        u = e(l, h);
      }
      return s.set(l, u), c ? (await t(l, a.Q, u.Q), await t(l, a.detune, u.detune), await t(l, a.frequency, u.frequency), await t(l, a.gain, u.gain)) : (await n(l, a.Q, u.Q), await n(l, a.detune, u.detune), await n(l, a.frequency, u.frequency), await n(l, a.gain, u.gain)), await o(a, l, u), u;
    };
    return { render(a, l) {
      let u = s.get(l);
      return u !== void 0 ? Promise.resolve(u) : i(a, l);
    } };
  };
  var t_ = (t, e) => (r, n) => {
    let o = e.get(r);
    if (o !== void 0) return o;
    let s = t.get(r);
    if (s !== void 0) return s;
    try {
      let i = n();
      return i instanceof Promise ? (t.set(r, i), i.catch(() => false).then((a) => (t.delete(r), e.set(r, a), a))) : (e.set(r, i), i);
    } catch {
      return e.set(r, false), false;
    }
  };
  var R1 = { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers", numberOfInputs: 6 }, r_ = (t, e, r, n, o) => class extends t {
    constructor(i, a) {
      let l = n(i), u = { ...R1, ...a }, c = r(l, u), h = o(l) ? e() : null;
      super(i, false, c, h);
    }
  };
  var n_ = (t, e, r) => () => {
    let n = /* @__PURE__ */ new WeakMap(), o = async (s, i) => {
      let a = e(s);
      if (!ae(a, i)) {
        let u = { channelCount: a.channelCount, channelCountMode: a.channelCountMode, channelInterpretation: a.channelInterpretation, numberOfInputs: a.numberOfInputs };
        a = t(i, u);
      }
      return n.set(i, a), await r(s, i, a), a;
    };
    return { render(s, i) {
      let a = n.get(i);
      return a !== void 0 ? Promise.resolve(a) : o(s, i);
    } };
  };
  var F1 = { channelCount: 6, channelCountMode: "explicit", channelInterpretation: "discrete", numberOfOutputs: 6 }, o_ = (t, e, r, n, o, s) => class extends t {
    constructor(a, l) {
      let u = n(a), c = s({ ...F1, ...l }), h = r(u, c), p = o(u) ? e() : null;
      super(a, false, h, p);
    }
  };
  var s_ = (t, e, r) => () => {
    let n = /* @__PURE__ */ new WeakMap(), o = async (s, i) => {
      let a = e(s);
      if (!ae(a, i)) {
        let u = { channelCount: a.channelCount, channelCountMode: a.channelCountMode, channelInterpretation: a.channelInterpretation, numberOfOutputs: a.numberOfOutputs };
        a = t(i, u);
      }
      return n.set(i, a), await r(s, i, a), a;
    };
    return { render(s, i) {
      let a = n.get(i);
      return a !== void 0 ? Promise.resolve(a) : o(s, i);
    } };
  };
  var i_ = (t) => (e, r, n) => t(r, e, n);
  var a_ = (t) => (e, r, n = 0, o = 0) => {
    let s = e[n];
    if (s === void 0) throw t();
    return to(r) ? s.connect(r, 0, o) : s.connect(r, 0);
  };
  var l_ = (t) => (e, r) => {
    let n = t(e, { buffer: null, channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers", loop: false, loopEnd: 0, loopStart: 0, playbackRate: 1 }), o = e.createBuffer(1, 2, 44100);
    return n.buffer = o, n.loop = true, n.connect(r), n.start(), () => {
      n.stop(), n.disconnect(r);
    };
  };
  var I1 = { channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers", offset: 1 }, u_ = (t, e, r, n, o, s, i) => class extends t {
    constructor(l, u) {
      let c = o(l), h = { ...I1, ...u }, p = n(c, h), d = s(c), m = d ? r() : null;
      super(l, false, p, m), this._constantSourceNodeRenderer = m, this._nativeConstantSourceNode = p, this._offset = e(this, d, p.offset, De, Re), this._onended = null;
    }
    get offset() {
      return this._offset;
    }
    get onended() {
      return this._onended;
    }
    set onended(l) {
      let u = typeof l == "function" ? i(this, l) : null;
      this._nativeConstantSourceNode.onended = u;
      let c = this._nativeConstantSourceNode.onended;
      this._onended = c !== null && c === u ? l : c;
    }
    start(l = 0) {
      if (this._nativeConstantSourceNode.start(l), this._constantSourceNodeRenderer !== null && (this._constantSourceNodeRenderer.start = l), this.context.state !== "closed") {
        fr(this);
        let u = () => {
          this._nativeConstantSourceNode.removeEventListener("ended", u), _t(this) && Dr(this);
        };
        this._nativeConstantSourceNode.addEventListener("ended", u);
      }
    }
    stop(l = 0) {
      this._nativeConstantSourceNode.stop(l), this._constantSourceNodeRenderer !== null && (this._constantSourceNodeRenderer.stop = l);
    }
  };
  var c_ = (t, e, r, n, o) => () => {
    let s = /* @__PURE__ */ new WeakMap(), i = null, a = null, l = async (u, c) => {
      let h = r(u), p = ae(h, c);
      if (!p) {
        let d = { channelCount: h.channelCount, channelCountMode: h.channelCountMode, channelInterpretation: h.channelInterpretation, offset: h.offset.value };
        h = e(c, d), i !== null && h.start(i), a !== null && h.stop(a);
      }
      return s.set(c, h), p ? await t(c, u.offset, h.offset) : await n(c, u.offset, h.offset), await o(u, c, h), h;
    };
    return { set start(u) {
      i = u;
    }, set stop(u) {
      a = u;
    }, render(u, c) {
      let h = s.get(c);
      return h !== void 0 ? Promise.resolve(h) : l(u, c);
    } };
  };
  var h_ = (t) => (e) => (t[0] = e, t[0]);
  var P1 = { buffer: null, channelCount: 2, channelCountMode: "clamped-max", channelInterpretation: "speakers", disableNormalization: false }, p_ = (t, e, r, n, o, s) => class extends t {
    constructor(a, l) {
      let u = n(a), c = { ...P1, ...l }, h = r(u, c), d = o(u) ? e() : null;
      super(a, false, h, d), this._isBufferNullified = false, this._nativeConvolverNode = h, c.buffer !== null && s(this, c.buffer.duration);
    }
    get buffer() {
      return this._isBufferNullified ? null : this._nativeConvolverNode.buffer;
    }
    set buffer(a) {
      if (this._nativeConvolverNode.buffer = a, a === null && this._nativeConvolverNode.buffer !== null) {
        let l = this._nativeConvolverNode.context;
        this._nativeConvolverNode.buffer = l.createBuffer(1, 1, l.sampleRate), this._isBufferNullified = true, s(this, 0);
      } else this._isBufferNullified = false, s(this, this._nativeConvolverNode.buffer === null ? 0 : this._nativeConvolverNode.buffer.duration);
    }
    get normalize() {
      return this._nativeConvolverNode.normalize;
    }
    set normalize(a) {
      this._nativeConvolverNode.normalize = a;
    }
  };
  var f_ = (t, e, r) => () => {
    let n = /* @__PURE__ */ new WeakMap(), o = async (s, i) => {
      let a = e(s);
      if (!ae(a, i)) {
        let u = { buffer: a.buffer, channelCount: a.channelCount, channelCountMode: a.channelCountMode, channelInterpretation: a.channelInterpretation, disableNormalization: !a.normalize };
        a = t(i, u);
      }
      return n.set(i, a), er(a) ? await r(s, i, a.inputs[0]) : await r(s, i, a), a;
    };
    return { render(s, i) {
      let a = n.get(i);
      return a !== void 0 ? Promise.resolve(a) : o(s, i);
    } };
  };
  var d_ = (t, e) => (r, n, o) => {
    if (e === null) throw new Error("Missing the native OfflineAudioContext constructor.");
    try {
      return new e(r, n, o);
    } catch (s) {
      throw s.name === "SyntaxError" ? t() : s;
    }
  };
  var m_ = () => new DOMException("", "DataCloneError");
  var Ih = (t) => {
    let { port1: e, port2: r } = new MessageChannel();
    return new Promise((n) => {
      let o = () => {
        r.onmessage = null, e.close(), r.close(), n();
      };
      r.onmessage = () => o();
      try {
        e.postMessage(t, [t]);
      } catch {
      } finally {
        o();
      }
    });
  };
  var g_ = (t, e, r, n, o, s, i, a, l, u, c) => (h, p) => {
    let d = i(h) ? h : s(h);
    if (o.has(p)) {
      let m = r();
      return Promise.reject(m);
    }
    try {
      o.add(p);
    } catch {
    }
    return e(l, () => l(d)) ? d.decodeAudioData(p).then((m) => (Ih(p).catch(() => {
    }), e(a, () => a(m)) || c(m), t.add(m), m)) : new Promise((m, y) => {
      let T = async () => {
        try {
          await Ih(p);
        } catch {
        }
      }, f = (g) => {
        y(g), T();
      };
      try {
        d.decodeAudioData(p, (g) => {
          typeof g.copyFromChannel != "function" && (u(g), Ho(g)), t.add(g), T().then(() => m(g));
        }, (g) => {
          f(g === null ? n() : g);
        });
      } catch (g) {
        f(g);
      }
    });
  };
  var __ = (t, e, r, n, o, s, i, a) => (l, u) => {
    let c = e.get(l);
    if (c === void 0) throw new Error("Missing the expected cycle count.");
    let h = s(l.context), p = a(h);
    if (c === u) {
      if (e.delete(l), !p && i(l)) {
        let d = n(l), { outputs: m } = r(l);
        for (let y of m) if (Dn(y)) {
          let T = n(y[0]);
          t(d, T, y[1], y[2]);
        } else {
          let T = o(y[0]);
          d.connect(T, y[1]);
        }
      }
    } else e.set(l, c - u);
  };
  var V1 = { channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers", delayTime: 0, maxDelayTime: 1 }, x_ = (t, e, r, n, o, s, i) => class extends t {
    constructor(l, u) {
      let c = o(l), h = { ...V1, ...u }, p = n(c, h), d = s(c), m = d ? r(h.maxDelayTime) : null;
      super(l, false, p, m), this._delayTime = e(this, d, p.delayTime), i(this, h.maxDelayTime);
    }
    get delayTime() {
      return this._delayTime;
    }
  };
  var y_ = (t, e, r, n, o) => (s) => {
    let i = /* @__PURE__ */ new WeakMap(), a = async (l, u) => {
      let c = r(l), h = ae(c, u);
      if (!h) {
        let p = { channelCount: c.channelCount, channelCountMode: c.channelCountMode, channelInterpretation: c.channelInterpretation, delayTime: c.delayTime.value, maxDelayTime: s };
        c = e(u, p);
      }
      return i.set(u, c), h ? await t(u, l.delayTime, c.delayTime) : await n(u, l.delayTime, c.delayTime), await o(l, u, c), c;
    };
    return { render(l, u) {
      let c = i.get(u);
      return c !== void 0 ? Promise.resolve(c) : a(l, u);
    } };
  };
  var v_ = (t) => (e, r, n, o) => t(e[o], (s) => s[0] === r && s[1] === n);
  var w_ = (t) => (e, r) => {
    t(e).delete(r);
  };
  var S_ = (t) => "delayTime" in t;
  var T_ = (t, e, r) => function n(o, s) {
    let i = Jn(s) ? s : r(t, s);
    if (S_(i)) return [];
    if (o[0] === i) return [o];
    if (o.includes(i)) return [];
    let { outputs: a } = e(i);
    return Array.from(a).map((l) => n([...o, i], l[0])).reduce((l, u) => l.concat(u), []);
  };
  var Al = (t, e, r) => {
    let n = e[r];
    if (n === void 0) throw t();
    return n;
  }, A_ = (t) => (e, r = void 0, n = void 0, o = 0) => r === void 0 ? e.forEach((s) => s.disconnect()) : typeof r == "number" ? Al(t, e, r).disconnect() : to(r) ? n === void 0 ? e.forEach((s) => s.disconnect(r)) : o === void 0 ? Al(t, e, n).disconnect(r, 0) : Al(t, e, n).disconnect(r, 0, o) : n === void 0 ? e.forEach((s) => s.disconnect(r)) : Al(t, e, n).disconnect(r, 0);
  var L1 = { attack: 3e-3, channelCount: 2, channelCountMode: "clamped-max", channelInterpretation: "speakers", knee: 30, ratio: 12, release: 0.25, threshold: -24 }, k_ = (t, e, r, n, o, s, i, a) => class extends t {
    constructor(u, c) {
      let h = s(u), p = { ...L1, ...c }, d = n(h, p), m = i(h), y = m ? r() : null;
      super(u, false, d, y), this._attack = e(this, m, d.attack), this._knee = e(this, m, d.knee), this._nativeDynamicsCompressorNode = d, this._ratio = e(this, m, d.ratio), this._release = e(this, m, d.release), this._threshold = e(this, m, d.threshold), a(this, 6e-3);
    }
    get attack() {
      return this._attack;
    }
    get channelCount() {
      return this._nativeDynamicsCompressorNode.channelCount;
    }
    set channelCount(u) {
      let c = this._nativeDynamicsCompressorNode.channelCount;
      if (this._nativeDynamicsCompressorNode.channelCount = u, u > 2) throw this._nativeDynamicsCompressorNode.channelCount = c, o();
    }
    get channelCountMode() {
      return this._nativeDynamicsCompressorNode.channelCountMode;
    }
    set channelCountMode(u) {
      let c = this._nativeDynamicsCompressorNode.channelCountMode;
      if (this._nativeDynamicsCompressorNode.channelCountMode = u, u === "max") throw this._nativeDynamicsCompressorNode.channelCountMode = c, o();
    }
    get knee() {
      return this._knee;
    }
    get ratio() {
      return this._ratio;
    }
    get reduction() {
      return typeof this._nativeDynamicsCompressorNode.reduction.value == "number" ? this._nativeDynamicsCompressorNode.reduction.value : this._nativeDynamicsCompressorNode.reduction;
    }
    get release() {
      return this._release;
    }
    get threshold() {
      return this._threshold;
    }
  };
  var C_ = (t, e, r, n, o) => () => {
    let s = /* @__PURE__ */ new WeakMap(), i = async (a, l) => {
      let u = r(a), c = ae(u, l);
      if (!c) {
        let h = { attack: u.attack.value, channelCount: u.channelCount, channelCountMode: u.channelCountMode, channelInterpretation: u.channelInterpretation, knee: u.knee.value, ratio: u.ratio.value, release: u.release.value, threshold: u.threshold.value };
        u = e(l, h);
      }
      return s.set(l, u), c ? (await t(l, a.attack, u.attack), await t(l, a.knee, u.knee), await t(l, a.ratio, u.ratio), await t(l, a.release, u.release), await t(l, a.threshold, u.threshold)) : (await n(l, a.attack, u.attack), await n(l, a.knee, u.knee), await n(l, a.ratio, u.ratio), await n(l, a.release, u.release), await n(l, a.threshold, u.threshold)), await o(a, l, u), u;
    };
    return { render(a, l) {
      let u = s.get(l);
      return u !== void 0 ? Promise.resolve(u) : i(a, l);
    } };
  };
  var N_ = () => new DOMException("", "EncodingError");
  var O_ = (t) => (e) => new Promise((r, n) => {
    if (t === null) {
      n(new SyntaxError());
      return;
    }
    let o = t.document.head;
    if (o === null) n(new SyntaxError());
    else {
      let s = t.document.createElement("script"), i = new Blob([e], { type: "application/javascript" }), a = URL.createObjectURL(i), l = t.onerror, u = () => {
        t.onerror = l, URL.revokeObjectURL(a);
      };
      t.onerror = (c, h, p, d, m) => {
        if (h === a || h === t.location.href && p === 1 && d === 1) return u(), n(m), false;
        if (l !== null) return l(c, h, p, d, m);
      }, s.onerror = () => {
        u(), n(new SyntaxError());
      }, s.onload = () => {
        u(), r();
      }, s.src = a, s.type = "module", o.appendChild(s);
    }
  });
  var E_ = (t) => class {
    constructor(r) {
      this._nativeEventTarget = r, this._listeners = /* @__PURE__ */ new WeakMap();
    }
    addEventListener(r, n, o) {
      if (n !== null) {
        let s = this._listeners.get(n);
        s === void 0 && (s = t(this, n), typeof n == "function" && this._listeners.set(n, s)), this._nativeEventTarget.addEventListener(r, s, o);
      }
    }
    dispatchEvent(r) {
      return this._nativeEventTarget.dispatchEvent(r);
    }
    removeEventListener(r, n, o) {
      let s = n === null ? void 0 : this._listeners.get(n);
      this._nativeEventTarget.removeEventListener(r, s === void 0 ? null : s, o);
    }
  };
  var b_ = (t) => (e, r, n) => {
    Object.defineProperties(t, { currentFrame: { configurable: true, get() {
      return Math.round(e * r);
    } }, currentTime: { configurable: true, get() {
      return e;
    } } });
    try {
      return n();
    } finally {
      t !== null && (delete t.currentFrame, delete t.currentTime);
    }
  };
  var D_ = (t) => async (e) => {
    try {
      let r = await fetch(e);
      if (r.ok) return [await r.text(), r.url];
    } catch {
    }
    throw t();
  };
  var q1 = { channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers", gain: 1 }, M_ = (t, e, r, n, o, s) => class extends t {
    constructor(a, l) {
      let u = o(a), c = { ...q1, ...l }, h = n(u, c), p = s(u), d = p ? r() : null;
      super(a, false, h, d), this._gain = e(this, p, h.gain, De, Re);
    }
    get gain() {
      return this._gain;
    }
  };
  var R_ = (t, e, r, n, o) => () => {
    let s = /* @__PURE__ */ new WeakMap(), i = async (a, l) => {
      let u = r(a), c = ae(u, l);
      if (!c) {
        let h = { channelCount: u.channelCount, channelCountMode: u.channelCountMode, channelInterpretation: u.channelInterpretation, gain: u.gain.value };
        u = e(l, h);
      }
      return s.set(l, u), c ? await t(l, a.gain, u.gain) : await n(l, a.gain, u.gain), await o(a, l, u), u;
    };
    return { render(a, l) {
      let u = s.get(l);
      return u !== void 0 ? Promise.resolve(u) : i(a, l);
    } };
  };
  var F_ = (t, e) => (r) => e(t, r);
  var I_ = (t) => (e) => {
    let r = t(e);
    if (r.renderer === null) throw new Error("Missing the renderer of the given AudioNode in the audio graph.");
    return r.renderer;
  };
  var P_ = (t) => (e) => {
    var r;
    return (r = t.get(e)) !== null && r !== void 0 ? r : 0;
  };
  var V_ = (t) => (e) => {
    let r = t(e);
    if (r.renderer === null) throw new Error("Missing the renderer of the given AudioParam in the audio graph.");
    return r.renderer;
  };
  var L_ = (t) => (e) => t.get(e);
  var Te = () => new DOMException("", "InvalidStateError");
  var q_ = (t) => (e) => {
    let r = t.get(e);
    if (r === void 0) throw Te();
    return r;
  };
  var j_ = (t, e) => (r) => {
    let n = t.get(r);
    if (n !== void 0) return n;
    if (e === null) throw new Error("Missing the native OfflineAudioContext constructor.");
    return n = new e(1, 1, 44100), t.set(r, n), n;
  };
  var z_ = (t) => (e) => {
    let r = t.get(e);
    if (r === void 0) throw new Error("The context has no set of AudioWorkletNodes.");
    return r;
  };
  var es = () => new DOMException("", "InvalidAccessError");
  var W_ = (t) => {
    t.getFrequencyResponse = /* @__PURE__ */ ((e) => (r, n, o) => {
      if (r.length !== n.length || n.length !== o.length) throw es();
      return e.call(t, r, n, o);
    })(t.getFrequencyResponse);
  };
  var j1 = { channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers" }, B_ = (t, e, r, n, o, s) => class extends t {
    constructor(a, l) {
      let u = n(a), c = o(u), h = { ...j1, ...l }, p = e(u, c ? null : a.baseLatency, h), d = c ? r(h.feedback, h.feedforward) : null;
      super(a, false, p, d), W_(p), this._nativeIIRFilterNode = p, s(this, 1);
    }
    getFrequencyResponse(a, l, u) {
      return this._nativeIIRFilterNode.getFrequencyResponse(a, l, u);
    }
  };
  var kl = (t, e, r, n, o, s, i, a, l, u, c) => {
    let h = u.length, p = a;
    for (let d = 0; d < h; d += 1) {
      let m = r[0] * u[d];
      for (let y = 1; y < o; y += 1) {
        let T = p - y & l - 1;
        m += r[y] * s[T], m -= t[y] * i[T];
      }
      for (let y = o; y < n; y += 1) m += r[y] * s[p - y & l - 1];
      for (let y = o; y < e; y += 1) m -= t[y] * i[p - y & l - 1];
      s[p] = u[d], i[p] = m, p = p + 1 & l - 1, c[d] = m;
    }
    return p;
  };
  var z1 = (t, e, r, n) => {
    let o = r instanceof Float64Array ? r : new Float64Array(r), s = n instanceof Float64Array ? n : new Float64Array(n), i = o.length, a = s.length, l = Math.min(i, a);
    if (o[0] !== 1) {
      for (let m = 0; m < i; m += 1) s[m] /= o[0];
      for (let m = 1; m < a; m += 1) o[m] /= o[0];
    }
    let u = 32, c = new Float32Array(u), h = new Float32Array(u), p = e.createBuffer(t.numberOfChannels, t.length, t.sampleRate), d = t.numberOfChannels;
    for (let m = 0; m < d; m += 1) {
      let y = t.getChannelData(m), T = p.getChannelData(m);
      c.fill(0), h.fill(0), kl(o, i, s, a, l, c, h, 0, u, y, T);
    }
    return p;
  }, U_ = (t, e, r, n, o) => (s, i) => {
    let a = /* @__PURE__ */ new WeakMap(), l = null, u = async (c, h) => {
      let p = null, d = e(c), m = ae(d, h);
      if (h.createIIRFilter === void 0 ? p = t(h, { buffer: null, channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers", loop: false, loopEnd: 0, loopStart: 0, playbackRate: 1 }) : m || (d = h.createIIRFilter(i, s)), a.set(h, p === null ? d : p), p !== null) {
        if (l === null) {
          if (r === null) throw new Error("Missing the native OfflineAudioContext constructor.");
          let T = new r(c.context.destination.channelCount, c.context.length, h.sampleRate);
          l = (async () => {
            await n(c, T, T.destination);
            let f = await o(T);
            return z1(f, h, s, i);
          })();
        }
        let y = await l;
        return p.buffer = y, p.start(0), p;
      }
      return await n(c, h, d), d;
    };
    return { render(c, h) {
      let p = a.get(h);
      return p !== void 0 ? Promise.resolve(p) : u(c, h);
    } };
  };
  var G_ = (t, e, r, n, o, s) => (i) => (a, l) => {
    let u = t.get(a);
    if (u === void 0) {
      if (!i && s(a)) {
        let c = n(a), { outputs: h } = r(a);
        for (let p of h) if (Dn(p)) {
          let d = n(p[0]);
          e(c, d, p[1], p[2]);
        } else {
          let d = o(p[0]);
          c.disconnect(d, p[1]);
        }
      }
      t.set(a, l);
    } else t.set(a, u + l);
  };
  var Q_ = (t, e) => (r) => {
    let n = t.get(r);
    return e(n) || e(r);
  };
  var H_ = (t, e) => (r) => t.has(r) || e(r);
  var $_ = (t, e) => (r) => t.has(r) || e(r);
  var Y_ = (t, e) => (r) => {
    let n = t.get(r);
    return e(n) || e(r);
  };
  var X_ = (t) => (e) => t !== null && e instanceof t;
  var Z_ = (t) => (e) => t !== null && typeof t.AudioNode == "function" && e instanceof t.AudioNode;
  var K_ = (t) => (e) => t !== null && typeof t.AudioParam == "function" && e instanceof t.AudioParam;
  var J_ = (t, e) => (r) => t(r) || e(r);
  var ex = (t) => (e) => t !== null && e instanceof t;
  var tx = (t) => t !== null && t.isSecureContext;
  var rx = (t, e, r, n) => class extends t {
    constructor(s, i) {
      let a = r(s), l = e(a, i);
      if (n(a)) throw TypeError();
      super(s, true, l, null), this._nativeMediaElementAudioSourceNode = l;
    }
    get mediaElement() {
      return this._nativeMediaElementAudioSourceNode.mediaElement;
    }
  };
  var W1 = { channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers" }, nx = (t, e, r, n) => class extends t {
    constructor(s, i) {
      let a = r(s);
      if (n(a)) throw new TypeError();
      let l = { ...W1, ...i }, u = e(a, l);
      super(s, false, u, null), this._nativeMediaStreamAudioDestinationNode = u;
    }
    get stream() {
      return this._nativeMediaStreamAudioDestinationNode.stream;
    }
  };
  var ox = (t, e, r, n) => class extends t {
    constructor(s, i) {
      let a = r(s), l = e(a, i);
      if (n(a)) throw new TypeError();
      super(s, true, l, null), this._nativeMediaStreamAudioSourceNode = l;
    }
    get mediaStream() {
      return this._nativeMediaStreamAudioSourceNode.mediaStream;
    }
  };
  var sx = (t, e, r) => class extends t {
    constructor(o, s) {
      let i = r(o), a = e(i, s);
      super(o, true, a, null);
    }
  };
  var ix = (t, e, r, n, o) => class extends n {
    constructor(i = {}) {
      if (o === null) throw new Error("Missing the native AudioContext constructor.");
      let a;
      try {
        a = new o(i);
      } catch (c) {
        throw c.code === 12 && c.message === "sampleRate is not in range" ? e() : c;
      }
      if (a === null) throw r();
      if (!wl(i.latencyHint)) throw new TypeError(`The provided value '${i.latencyHint}' is not a valid enum value of type AudioContextLatencyCategory.`);
      if (i.sampleRate !== void 0 && a.sampleRate !== i.sampleRate) throw e();
      super(a, 2);
      let { latencyHint: l } = i, { sampleRate: u } = a;
      if (this._baseLatency = typeof a.baseLatency == "number" ? a.baseLatency : l === "balanced" ? 512 / u : l === "interactive" || l === void 0 ? 256 / u : l === "playback" ? 1024 / u : Math.max(2, Math.min(128, Math.round(l * u / 128))) * 128 / u, this._nativeAudioContext = a, o.name === "webkitAudioContext" ? (this._nativeGainNode = a.createGain(), this._nativeOscillatorNode = a.createOscillator(), this._nativeGainNode.gain.value = 1e-37, this._nativeOscillatorNode.connect(this._nativeGainNode).connect(a.destination), this._nativeOscillatorNode.start()) : (this._nativeGainNode = null, this._nativeOscillatorNode = null), this._state = null, a.state === "running") {
        this._state = "suspended";
        let c = () => {
          this._state === "suspended" && (this._state = null), a.removeEventListener("statechange", c);
        };
        a.addEventListener("statechange", c);
      }
    }
    get baseLatency() {
      return this._baseLatency;
    }
    get state() {
      return this._state !== null ? this._state : this._nativeAudioContext.state;
    }
    close() {
      return this.state === "closed" ? this._nativeAudioContext.close().then(() => {
        throw t();
      }) : (this._state === "suspended" && (this._state = null), this._nativeAudioContext.close().then(() => {
        this._nativeGainNode !== null && this._nativeOscillatorNode !== null && (this._nativeOscillatorNode.stop(), this._nativeGainNode.disconnect(), this._nativeOscillatorNode.disconnect()), bn(this);
      }));
    }
    resume() {
      return this._state === "suspended" ? new Promise((i, a) => {
        let l = () => {
          this._nativeAudioContext.removeEventListener("statechange", l), this._nativeAudioContext.state === "running" ? i() : this.resume().then(i, a);
        };
        this._nativeAudioContext.addEventListener("statechange", l);
      }) : this._nativeAudioContext.resume().catch((i) => {
        throw i === void 0 || i.code === 15 ? t() : i;
      });
    }
    suspend() {
      return this._nativeAudioContext.suspend().catch((i) => {
        throw i === void 0 ? t() : i;
      });
    }
  };
  var ax = (t, e, r, n, o, s) => class extends r {
    constructor(a, l) {
      super(a), this._nativeContext = a, Go.set(this, a), n(a) && o.set(a, /* @__PURE__ */ new Set()), this._destination = new t(this, l), this._listener = e(this, a), this._onstatechange = null;
    }
    get currentTime() {
      return this._nativeContext.currentTime;
    }
    get destination() {
      return this._destination;
    }
    get listener() {
      return this._listener;
    }
    get onstatechange() {
      return this._onstatechange;
    }
    set onstatechange(a) {
      let l = typeof a == "function" ? s(this, a) : null;
      this._nativeContext.onstatechange = l;
      let u = this._nativeContext.onstatechange;
      this._onstatechange = u !== null && u === l ? a : u;
    }
    get sampleRate() {
      return this._nativeContext.sampleRate;
    }
    get state() {
      return this._nativeContext.state;
    }
  };
  var mr = (t) => {
    let e = new Uint32Array([1179011410, 40, 1163280727, 544501094, 16, 131073, 44100, 176400, 1048580, 1635017060, 4, 0]);
    try {
      let r = t.decodeAudioData(e.buffer, () => {
      });
      return r === void 0 ? false : (r.catch(() => {
      }), true);
    } catch {
    }
    return false;
  };
  var B1 = { numberOfChannels: 1 }, lx = (t, e, r, n, o) => class extends n {
    constructor(i) {
      let { length: a, numberOfChannels: l, sampleRate: u } = { ...B1, ...i }, c = r(l, a, u);
      t(mr, () => mr(c)) || c.addEventListener("statechange", /* @__PURE__ */ (() => {
        let h = 0, p = (d) => {
          this._state === "running" && (h > 0 ? (c.removeEventListener("statechange", p), d.stopImmediatePropagation(), this._waitForThePromiseToSettle(d)) : h += 1);
        };
        return p;
      })()), super(c, l), this._length = a, this._nativeOfflineAudioContext = c, this._state = null;
    }
    get length() {
      return this._nativeOfflineAudioContext.length === void 0 ? this._length : this._nativeOfflineAudioContext.length;
    }
    get state() {
      return this._state === null ? this._nativeOfflineAudioContext.state : this._state;
    }
    startRendering() {
      return this._state === "running" ? Promise.reject(e()) : (this._state = "running", o(this.destination, this._nativeOfflineAudioContext).finally(() => {
        this._state = null, bn(this);
      }));
    }
    _waitForThePromiseToSettle(i) {
      this._state === null ? this._nativeOfflineAudioContext.dispatchEvent(i) : setTimeout(() => this._waitForThePromiseToSettle(i));
    }
  };
  var ux = (t, e) => (r, n, o) => {
    let s = /* @__PURE__ */ new Set();
    return r.connect = /* @__PURE__ */ ((i) => (a, l = 0, u = 0) => {
      let c = s.size === 0;
      if (e(a)) return i.call(r, a, l, u), t(s, [a, l, u], (h) => h[0] === a && h[1] === l && h[2] === u, true), c && n(), a;
      i.call(r, a, l), t(s, [a, l], (h) => h[0] === a && h[1] === l, true), c && n();
    })(r.connect), r.disconnect = /* @__PURE__ */ ((i) => (a, l, u) => {
      let c = s.size > 0;
      if (a === void 0) i.apply(r), s.clear();
      else if (typeof a == "number") {
        i.call(r, a);
        for (let p of s) p[1] === a && s.delete(p);
      } else {
        e(a) ? i.call(r, a, l, u) : i.call(r, a, l);
        for (let p of s) p[0] === a && (l === void 0 || p[1] === l) && (u === void 0 || p[2] === u) && s.delete(p);
      }
      let h = s.size === 0;
      c && h && o();
    })(r.disconnect), r;
  };
  var le = (t, e, r) => {
    let n = e[r];
    n !== void 0 && n !== t[r] && (t[r] = n);
  };
  var ne = (t, e) => {
    le(t, e, "channelCount"), le(t, e, "channelCountMode"), le(t, e, "channelInterpretation");
  };
  var Ph = (t) => typeof t.getFloatTimeDomainData == "function";
  var cx = (t) => {
    t.getFloatTimeDomainData = (e) => {
      let r = new Uint8Array(e.length);
      t.getByteTimeDomainData(r);
      let n = Math.max(r.length, t.fftSize);
      for (let o = 0; o < n; o += 1) e[o] = (r[o] - 128) * 78125e-7;
      return e;
    };
  };
  var hx = (t, e) => (r, n) => {
    let o = r.createAnalyser();
    if (ne(o, n), !(n.maxDecibels > n.minDecibels)) throw e();
    return le(o, n, "fftSize"), le(o, n, "maxDecibels"), le(o, n, "minDecibels"), le(o, n, "smoothingTimeConstant"), t(Ph, () => Ph(o)) || cx(o), o;
  };
  var px = (t) => t === null ? null : t.hasOwnProperty("AudioBuffer") ? t.AudioBuffer : null;
  var he = (t, e, r) => {
    let n = e[r];
    n !== void 0 && n !== t[r].value && (t[r].value = n);
  };
  var fx = (t) => {
    t.start = /* @__PURE__ */ ((e) => {
      let r = false;
      return (n = 0, o = 0, s) => {
        if (r) throw Te();
        e.call(t, n, o, s), r = true;
      };
    })(t.start);
  };
  var ts = (t) => {
    t.start = /* @__PURE__ */ ((e) => (r = 0, n = 0, o) => {
      if (typeof o == "number" && o < 0 || n < 0 || r < 0) throw new RangeError("The parameters can't be negative.");
      e.call(t, r, n, o);
    })(t.start);
  };
  var rs = (t) => {
    t.stop = /* @__PURE__ */ ((e) => (r = 0) => {
      if (r < 0) throw new RangeError("The parameter can't be negative.");
      e.call(t, r);
    })(t.stop);
  };
  var dx = (t, e, r, n, o, s, i, a, l, u, c) => (h, p) => {
    let d = h.createBufferSource();
    return ne(d, p), he(d, p, "playbackRate"), le(d, p, "buffer"), le(d, p, "loop"), le(d, p, "loopEnd"), le(d, p, "loopStart"), e(r, () => r(h)) || fx(d), e(n, () => n(h)) || l(d), e(o, () => o(h)) || u(d, h), e(s, () => s(h)) || ts(d), e(i, () => i(h)) || c(d, h), e(a, () => a(h)) || rs(d), t(h, d), d;
  };
  var mx = (t) => t === null ? null : t.hasOwnProperty("AudioContext") ? t.AudioContext : t.hasOwnProperty("webkitAudioContext") ? t.webkitAudioContext : null;
  var gx = (t, e) => (r, n, o) => {
    let s = r.destination;
    if (s.channelCount !== n) try {
      s.channelCount = n;
    } catch {
    }
    o && s.channelCountMode !== "explicit" && (s.channelCountMode = "explicit"), s.maxChannelCount === 0 && Object.defineProperty(s, "maxChannelCount", { value: n });
    let i = t(r, { channelCount: n, channelCountMode: s.channelCountMode, channelInterpretation: s.channelInterpretation, gain: 1 });
    return e(i, "channelCount", (a) => () => a.call(i), (a) => (l) => {
      a.call(i, l);
      try {
        s.channelCount = l;
      } catch (u) {
        if (l > s.maxChannelCount) throw u;
      }
    }), e(i, "channelCountMode", (a) => () => a.call(i), (a) => (l) => {
      a.call(i, l), s.channelCountMode = l;
    }), e(i, "channelInterpretation", (a) => () => a.call(i), (a) => (l) => {
      a.call(i, l), s.channelInterpretation = l;
    }), Object.defineProperty(i, "maxChannelCount", { get: () => s.maxChannelCount }), i.connect(s), i;
  };
  var _x = (t) => t === null ? null : t.hasOwnProperty("AudioWorkletNode") ? t.AudioWorkletNode : null;
  var xx = (t) => {
    let { port1: e } = new MessageChannel();
    try {
      e.postMessage(t);
    } finally {
      e.close();
    }
  };
  var yx = (t, e, r, n, o) => (s, i, a, l, u, c) => {
    if (a !== null) try {
      let h = new a(s, l, c), p = /* @__PURE__ */ new Map(), d = null;
      if (Object.defineProperties(h, { channelCount: { get: () => c.channelCount, set: () => {
        throw t();
      } }, channelCountMode: { get: () => "explicit", set: () => {
        throw t();
      } }, onprocessorerror: { get: () => d, set: (m) => {
        typeof d == "function" && h.removeEventListener("processorerror", d), d = typeof m == "function" ? m : null, typeof d == "function" && h.addEventListener("processorerror", d);
      } } }), h.addEventListener = /* @__PURE__ */ ((m) => (...y) => {
        if (y[0] === "processorerror") {
          let T = typeof y[1] == "function" ? y[1] : typeof y[1] == "object" && y[1] !== null && typeof y[1].handleEvent == "function" ? y[1].handleEvent : null;
          if (T !== null) {
            let f = p.get(y[1]);
            f !== void 0 ? y[1] = f : (y[1] = (g) => {
              g.type === "error" ? (Object.defineProperties(g, { type: { value: "processorerror" } }), T(g)) : T(new ErrorEvent(y[0], { ...g }));
            }, p.set(T, y[1]));
          }
        }
        return m.call(h, "error", y[1], y[2]), m.call(h, ...y);
      })(h.addEventListener), h.removeEventListener = /* @__PURE__ */ ((m) => (...y) => {
        if (y[0] === "processorerror") {
          let T = p.get(y[1]);
          T !== void 0 && (p.delete(y[1]), y[1] = T);
        }
        return m.call(h, "error", y[1], y[2]), m.call(h, y[0], y[1], y[2]);
      })(h.removeEventListener), c.numberOfOutputs !== 0) {
        let m = r(s, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "discrete", gain: 0 });
        return h.connect(m).connect(s.destination), o(h, () => m.disconnect(), () => m.connect(s.destination));
      }
      return h;
    } catch (h) {
      throw h.code === 11 ? n() : h;
    }
    if (u === void 0) throw n();
    return xx(c), e(s, i, u, c);
  };
  var Cl = (t, e) => t === null ? 512 : Math.max(512, Math.min(16384, Math.pow(2, Math.round(Math.log2(t * e)))));
  var vx = (t) => new Promise((e, r) => {
    let { port1: n, port2: o } = new MessageChannel();
    n.onmessage = ({ data: s }) => {
      n.close(), o.close(), e(s);
    }, n.onmessageerror = ({ data: s }) => {
      n.close(), o.close(), r(s);
    }, o.postMessage(t);
  });
  var wx = async (t, e) => {
    let r = await vx(e);
    return new t(r);
  };
  var Sx = (t, e, r, n) => {
    let o = Mi.get(t);
    o === void 0 && (o = /* @__PURE__ */ new WeakMap(), Mi.set(t, o));
    let s = wx(r, n);
    return o.set(e, s), s;
  };
  var Tx = (t, e, r, n, o, s, i, a, l, u, c, h, p) => (d, m, y, T) => {
    if (T.numberOfInputs === 0 && T.numberOfOutputs === 0) throw l();
    let f = Array.isArray(T.outputChannelCount) ? T.outputChannelCount : Array.from(T.outputChannelCount);
    if (f.some((B) => B < 1)) throw l();
    if (f.length !== T.numberOfOutputs) throw e();
    if (T.channelCountMode !== "explicit") throw l();
    let g = T.channelCount * T.numberOfInputs, v = f.reduce((B, K) => B + K, 0), k = y.parameterDescriptors === void 0 ? 0 : y.parameterDescriptors.length;
    if (g + k > 6 || v > 6) throw l();
    let w = new MessageChannel(), A = [], C = [];
    for (let B = 0; B < T.numberOfInputs; B += 1) A.push(i(d, { channelCount: T.channelCount, channelCountMode: T.channelCountMode, channelInterpretation: T.channelInterpretation, gain: 1 })), C.push(o(d, { channelCount: T.channelCount, channelCountMode: "explicit", channelInterpretation: "discrete", numberOfOutputs: T.channelCount }));
    let _ = [];
    if (y.parameterDescriptors !== void 0) for (let { defaultValue: B, maxValue: K, minValue: Be, name: Ae } of y.parameterDescriptors) {
      let ce = s(d, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "discrete", offset: T.parameterData[Ae] !== void 0 ? T.parameterData[Ae] : B === void 0 ? 0 : B });
      Object.defineProperties(ce.offset, { defaultValue: { get: () => B === void 0 ? 0 : B }, maxValue: { get: () => K === void 0 ? De : K }, minValue: { get: () => Be === void 0 ? Re : Be } }), _.push(ce);
    }
    let x = n(d, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers", numberOfInputs: Math.max(1, g + k) }), E = Cl(m, d.sampleRate), D = a(d, E, g + k, Math.max(1, v)), F = o(d, { channelCount: Math.max(1, v), channelCountMode: "explicit", channelInterpretation: "discrete", numberOfOutputs: Math.max(1, v) }), q = [];
    for (let B = 0; B < T.numberOfOutputs; B += 1) q.push(n(d, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers", numberOfInputs: f[B] }));
    for (let B = 0; B < T.numberOfInputs; B += 1) {
      A[B].connect(C[B]);
      for (let K = 0; K < T.channelCount; K += 1) C[B].connect(x, K, B * T.channelCount + K);
    }
    let j = new Zo(y.parameterDescriptors === void 0 ? [] : y.parameterDescriptors.map(({ name: B }, K) => {
      let Be = _[K];
      return Be.connect(x, 0, g + K), Be.start(0), [B, Be.offset];
    }));
    x.connect(D);
    let L = T.channelInterpretation, N = null, S = T.numberOfOutputs === 0 ? [D] : q, b = { get bufferSize() {
      return E;
    }, get channelCount() {
      return T.channelCount;
    }, set channelCount(B) {
      throw r();
    }, get channelCountMode() {
      return T.channelCountMode;
    }, set channelCountMode(B) {
      throw r();
    }, get channelInterpretation() {
      return L;
    }, set channelInterpretation(B) {
      for (let K of A) K.channelInterpretation = B;
      L = B;
    }, get context() {
      return D.context;
    }, get inputs() {
      return A;
    }, get numberOfInputs() {
      return T.numberOfInputs;
    }, get numberOfOutputs() {
      return T.numberOfOutputs;
    }, get onprocessorerror() {
      return N;
    }, set onprocessorerror(B) {
      typeof N == "function" && b.removeEventListener("processorerror", N), N = typeof B == "function" ? B : null, typeof N == "function" && b.addEventListener("processorerror", N);
    }, get parameters() {
      return j;
    }, get port() {
      return w.port2;
    }, addEventListener(...B) {
      return D.addEventListener(B[0], B[1], B[2]);
    }, connect: t.bind(null, S), disconnect: u.bind(null, S), dispatchEvent(...B) {
      return D.dispatchEvent(B[0]);
    }, removeEventListener(...B) {
      return D.removeEventListener(B[0], B[1], B[2]);
    } }, M = /* @__PURE__ */ new Map();
    w.port1.addEventListener = /* @__PURE__ */ ((B) => (...K) => {
      if (K[0] === "message") {
        let Be = typeof K[1] == "function" ? K[1] : typeof K[1] == "object" && K[1] !== null && typeof K[1].handleEvent == "function" ? K[1].handleEvent : null;
        if (Be !== null) {
          let Ae = M.get(K[1]);
          Ae !== void 0 ? K[1] = Ae : (K[1] = (ce) => {
            c(d.currentTime, d.sampleRate, () => Be(ce));
          }, M.set(Be, K[1]));
        }
      }
      return B.call(w.port1, K[0], K[1], K[2]);
    })(w.port1.addEventListener), w.port1.removeEventListener = /* @__PURE__ */ ((B) => (...K) => {
      if (K[0] === "message") {
        let Be = M.get(K[1]);
        Be !== void 0 && (M.delete(K[1]), K[1] = Be);
      }
      return B.call(w.port1, K[0], K[1], K[2]);
    })(w.port1.removeEventListener);
    let I = null;
    Object.defineProperty(w.port1, "onmessage", { get: () => I, set: (B) => {
      typeof I == "function" && w.port1.removeEventListener("message", I), I = typeof B == "function" ? B : null, typeof I == "function" && (w.port1.addEventListener("message", I), w.port1.start());
    } }), y.prototype.port = w.port1;
    let R = null;
    Sx(d, b, y, T).then((B) => R = B);
    let Y = Jo(T.numberOfInputs, T.channelCount), ee = Jo(T.numberOfOutputs, f), W = y.parameterDescriptors === void 0 ? [] : y.parameterDescriptors.reduce((B, { name: K }) => ({ ...B, [K]: new Float32Array(128) }), {}), ie = true, ge = () => {
      T.numberOfOutputs > 0 && D.disconnect(F);
      for (let B = 0, K = 0; B < T.numberOfOutputs; B += 1) {
        let Be = q[B];
        for (let Ae = 0; Ae < f[B]; Ae += 1) F.disconnect(Be, K + Ae, Ae);
        K += f[B];
      }
    }, G = /* @__PURE__ */ new Map();
    D.onaudioprocess = ({ inputBuffer: B, outputBuffer: K }) => {
      if (R !== null) {
        let Be = h(b);
        for (let Ae = 0; Ae < E; Ae += 128) {
          for (let ce = 0; ce < T.numberOfInputs; ce += 1) for (let Ee = 0; Ee < T.channelCount; Ee += 1) Ko(B, Y[ce], Ee, Ee, Ae);
          y.parameterDescriptors !== void 0 && y.parameterDescriptors.forEach(({ name: ce }, Ee) => {
            Ko(B, W, ce, g + Ee, Ae);
          });
          for (let ce = 0; ce < T.numberOfInputs; ce += 1) for (let Ee = 0; Ee < f[ce]; Ee += 1) ee[ce][Ee].byteLength === 0 && (ee[ce][Ee] = new Float32Array(128));
          try {
            let ce = Y.map((Gt, sn) => {
              if (Be[sn].size > 0) return G.set(sn, E / 128), Gt;
              let ru = G.get(sn);
              return ru === void 0 ? [] : (Gt.every((Rv) => Rv.every((Fv) => Fv === 0)) && (ru === 1 ? G.delete(sn) : G.set(sn, ru - 1)), Gt);
            });
            ie = c(d.currentTime + Ae / d.sampleRate, d.sampleRate, () => R.process(ce, ee, W));
            for (let Gt = 0, sn = 0; Gt < T.numberOfOutputs; Gt += 1) {
              for (let ks = 0; ks < f[Gt]; ks += 1) Tl(K, ee[Gt], ks, sn + ks, Ae);
              sn += f[Gt];
            }
          } catch (ce) {
            ie = false, b.dispatchEvent(new ErrorEvent("processorerror", { colno: ce.colno, filename: ce.filename, lineno: ce.lineno, message: ce.message }));
          }
          if (!ie) {
            for (let ce = 0; ce < T.numberOfInputs; ce += 1) {
              A[ce].disconnect(C[ce]);
              for (let Ee = 0; Ee < T.channelCount; Ee += 1) C[Ae].disconnect(x, Ee, ce * T.channelCount + Ee);
            }
            if (y.parameterDescriptors !== void 0) {
              let ce = y.parameterDescriptors.length;
              for (let Ee = 0; Ee < ce; Ee += 1) {
                let Gt = _[Ee];
                Gt.disconnect(x, 0, g + Ee), Gt.stop();
              }
            }
            x.disconnect(D), D.onaudioprocess = null, Ut ? ge() : po();
            break;
          }
        }
      }
    };
    let Ut = false, ot = i(d, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "discrete", gain: 0 }), ho = () => D.connect(ot).connect(d.destination), po = () => {
      D.disconnect(ot), ot.disconnect();
    }, Dv = () => {
      if (ie) {
        po(), T.numberOfOutputs > 0 && D.connect(F);
        for (let B = 0, K = 0; B < T.numberOfOutputs; B += 1) {
          let Be = q[B];
          for (let Ae = 0; Ae < f[B]; Ae += 1) F.connect(Be, K + Ae, Ae);
          K += f[B];
        }
      }
      Ut = true;
    }, Mv = () => {
      ie && (ho(), ge()), Ut = false;
    };
    return ho(), p(b, Dv, Mv);
  };
  var Vh = (t, e) => {
    let r = t.createBiquadFilter();
    return ne(r, e), he(r, e, "Q"), he(r, e, "detune"), he(r, e, "frequency"), he(r, e, "gain"), le(r, e, "type"), r;
  };
  var Ax = (t, e) => (r, n) => {
    let o = r.createChannelMerger(n.numberOfInputs);
    return t !== null && t.name === "webkitAudioContext" && e(r, o), ne(o, n), o;
  };
  var kx = (t) => {
    let e = t.numberOfOutputs;
    Object.defineProperty(t, "channelCount", { get: () => e, set: (r) => {
      if (r !== e) throw Te();
    } }), Object.defineProperty(t, "channelCountMode", { get: () => "explicit", set: (r) => {
      if (r !== "explicit") throw Te();
    } }), Object.defineProperty(t, "channelInterpretation", { get: () => "discrete", set: (r) => {
      if (r !== "discrete") throw Te();
    } });
  };
  var ns = (t, e) => {
    let r = t.createChannelSplitter(e.numberOfOutputs);
    return ne(r, e), kx(r), r;
  };
  var Cx = (t, e, r, n, o) => (s, i) => {
    if (s.createConstantSource === void 0) return r(s, i);
    let a = s.createConstantSource();
    return ne(a, i), he(a, i, "offset"), e(n, () => n(s)) || ts(a), e(o, () => o(s)) || rs(a), t(s, a), a;
  };
  var tr = (t, e) => (t.connect = e.connect.bind(e), t.disconnect = e.disconnect.bind(e), t);
  var Nx = (t, e, r, n) => (o, { offset: s, ...i }) => {
    let a = o.createBuffer(1, 2, 44100), l = e(o, { buffer: null, channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers", loop: false, loopEnd: 0, loopStart: 0, playbackRate: 1 }), u = r(o, { ...i, gain: s }), c = a.getChannelData(0);
    c[0] = 1, c[1] = 1, l.buffer = a, l.loop = true;
    let h = { get bufferSize() {
    }, get channelCount() {
      return u.channelCount;
    }, set channelCount(m) {
      u.channelCount = m;
    }, get channelCountMode() {
      return u.channelCountMode;
    }, set channelCountMode(m) {
      u.channelCountMode = m;
    }, get channelInterpretation() {
      return u.channelInterpretation;
    }, set channelInterpretation(m) {
      u.channelInterpretation = m;
    }, get context() {
      return u.context;
    }, get inputs() {
      return [];
    }, get numberOfInputs() {
      return l.numberOfInputs;
    }, get numberOfOutputs() {
      return u.numberOfOutputs;
    }, get offset() {
      return u.gain;
    }, get onended() {
      return l.onended;
    }, set onended(m) {
      l.onended = m;
    }, addEventListener(...m) {
      return l.addEventListener(m[0], m[1], m[2]);
    }, dispatchEvent(...m) {
      return l.dispatchEvent(m[0]);
    }, removeEventListener(...m) {
      return l.removeEventListener(m[0], m[1], m[2]);
    }, start(m = 0) {
      l.start.call(l, m);
    }, stop(m = 0) {
      l.stop.call(l, m);
    } }, p = () => l.connect(u), d = () => l.disconnect(u);
    return t(o, l), n(tr(h, u), p, d);
  };
  var Ox = (t, e) => (r, n) => {
    let o = r.createConvolver();
    if (ne(o, n), n.disableNormalization === o.normalize && (o.normalize = !n.disableNormalization), le(o, n, "buffer"), n.channelCount > 2 || (e(o, "channelCount", (s) => () => s.call(o), (s) => (i) => {
      if (i > 2) throw t();
      return s.call(o, i);
    }), n.channelCountMode === "max")) throw t();
    return e(o, "channelCountMode", (s) => () => s.call(o), (s) => (i) => {
      if (i === "max") throw t();
      return s.call(o, i);
    }), o;
  };
  var Lh = (t, e) => {
    let r = t.createDelay(e.maxDelayTime);
    return ne(r, e), he(r, e, "delayTime"), r;
  };
  var Ex = (t) => (e, r) => {
    let n = e.createDynamicsCompressor();
    if (ne(n, r), r.channelCount > 2 || r.channelCountMode === "max") throw t();
    return he(n, r, "attack"), he(n, r, "knee"), he(n, r, "ratio"), he(n, r, "release"), he(n, r, "threshold"), n;
  };
  var xt = (t, e) => {
    let r = t.createGain();
    return ne(r, e), he(r, e, "gain"), r;
  };
  var bx = (t) => (e, r, n) => {
    if (e.createIIRFilter === void 0) return t(e, r, n);
    let o = e.createIIRFilter(n.feedforward, n.feedback);
    return ne(o, n), o;
  };
  function U1(t, e) {
    let r = e[0] * e[0] + e[1] * e[1];
    return [(t[0] * e[0] + t[1] * e[1]) / r, (t[1] * e[0] - t[0] * e[1]) / r];
  }
  function G1(t, e) {
    return [t[0] * e[0] - t[1] * e[1], t[0] * e[1] + t[1] * e[0]];
  }
  function Dx(t, e) {
    let r = [0, 0];
    for (let n = t.length - 1; n >= 0; n -= 1) r = G1(r, e), r[0] += t[n];
    return r;
  }
  var Mx = (t, e, r, n) => (o, s, { channelCount: i, channelCountMode: a, channelInterpretation: l, feedback: u, feedforward: c }) => {
    let h = Cl(s, o.sampleRate), p = u instanceof Float64Array ? u : new Float64Array(u), d = c instanceof Float64Array ? c : new Float64Array(c), m = p.length, y = d.length, T = Math.min(m, y);
    if (m === 0 || m > 20) throw n();
    if (p[0] === 0) throw e();
    if (y === 0 || y > 20) throw n();
    if (d[0] === 0) throw e();
    if (p[0] !== 1) {
      for (let _ = 0; _ < y; _ += 1) d[_] /= p[0];
      for (let _ = 1; _ < m; _ += 1) p[_] /= p[0];
    }
    let f = r(o, h, i, i);
    f.channelCount = i, f.channelCountMode = a, f.channelInterpretation = l;
    let g = 32, v = [], k = [], w = [];
    for (let _ = 0; _ < i; _ += 1) {
      v.push(0);
      let x = new Float32Array(g), E = new Float32Array(g);
      x.fill(0), E.fill(0), k.push(x), w.push(E);
    }
    f.onaudioprocess = (_) => {
      let x = _.inputBuffer, E = _.outputBuffer, D = x.numberOfChannels;
      for (let F = 0; F < D; F += 1) {
        let q = x.getChannelData(F), j = E.getChannelData(F);
        v[F] = kl(p, m, d, y, T, k[F], w[F], v[F], g, q, j);
      }
    };
    let A = o.sampleRate / 2;
    return tr({ get bufferSize() {
      return h;
    }, get channelCount() {
      return f.channelCount;
    }, set channelCount(_) {
      f.channelCount = _;
    }, get channelCountMode() {
      return f.channelCountMode;
    }, set channelCountMode(_) {
      f.channelCountMode = _;
    }, get channelInterpretation() {
      return f.channelInterpretation;
    }, set channelInterpretation(_) {
      f.channelInterpretation = _;
    }, get context() {
      return f.context;
    }, get inputs() {
      return [f];
    }, get numberOfInputs() {
      return f.numberOfInputs;
    }, get numberOfOutputs() {
      return f.numberOfOutputs;
    }, addEventListener(..._) {
      return f.addEventListener(_[0], _[1], _[2]);
    }, dispatchEvent(..._) {
      return f.dispatchEvent(_[0]);
    }, getFrequencyResponse(_, x, E) {
      if (_.length !== x.length || x.length !== E.length) throw t();
      let D = _.length;
      for (let F = 0; F < D; F += 1) {
        let q = -Math.PI * (_[F] / A), j = [Math.cos(q), Math.sin(q)], L = Dx(d, j), N = Dx(p, j), S = U1(L, N);
        x[F] = Math.sqrt(S[0] * S[0] + S[1] * S[1]), E[F] = Math.atan2(S[1], S[0]);
      }
    }, removeEventListener(..._) {
      return f.removeEventListener(_[0], _[1], _[2]);
    } }, f);
  };
  var Rx = (t, e) => t.createMediaElementSource(e.mediaElement);
  var Fx = (t, e) => {
    let r = t.createMediaStreamDestination();
    return ne(r, e), r.numberOfOutputs === 1 && Object.defineProperty(r, "numberOfOutputs", { get: () => 0 }), r;
  };
  var Ix = (t, { mediaStream: e }) => {
    let r = e.getAudioTracks();
    r.sort((s, i) => s.id < i.id ? -1 : s.id > i.id ? 1 : 0);
    let n = r.slice(0, 1), o = t.createMediaStreamSource(new MediaStream(n));
    return Object.defineProperty(o, "mediaStream", { value: e }), o;
  };
  var Px = (t, e) => (r, { mediaStreamTrack: n }) => {
    if (typeof r.createMediaStreamTrackSource == "function") return r.createMediaStreamTrackSource(n);
    let o = new MediaStream([n]), s = r.createMediaStreamSource(o);
    if (n.kind !== "audio") throw t();
    if (e(r)) throw new TypeError();
    return s;
  };
  var Vx = (t) => t === null ? null : t.hasOwnProperty("OfflineAudioContext") ? t.OfflineAudioContext : t.hasOwnProperty("webkitOfflineAudioContext") ? t.webkitOfflineAudioContext : null;
  var Lx = (t, e, r, n, o, s) => (i, a) => {
    let l = i.createOscillator();
    return ne(l, a), he(l, a, "detune"), he(l, a, "frequency"), a.periodicWave !== void 0 ? l.setPeriodicWave(a.periodicWave) : le(l, a, "type"), e(r, () => r(i)) || ts(l), e(n, () => n(i)) || s(l, i), e(o, () => o(i)) || rs(l), t(i, l), l;
  };
  var qx = (t) => (e, r) => {
    let n = e.createPanner();
    return n.orientationX === void 0 ? t(e, r) : (ne(n, r), he(n, r, "orientationX"), he(n, r, "orientationY"), he(n, r, "orientationZ"), he(n, r, "positionX"), he(n, r, "positionY"), he(n, r, "positionZ"), le(n, r, "coneInnerAngle"), le(n, r, "coneOuterAngle"), le(n, r, "coneOuterGain"), le(n, r, "distanceModel"), le(n, r, "maxDistance"), le(n, r, "panningModel"), le(n, r, "refDistance"), le(n, r, "rolloffFactor"), n);
  };
  var jx = (t, e, r, n, o, s, i, a, l, u) => (c, { coneInnerAngle: h, coneOuterAngle: p, coneOuterGain: d, distanceModel: m, maxDistance: y, orientationX: T, orientationY: f, orientationZ: g, panningModel: v, positionX: k, positionY: w, positionZ: A, refDistance: C, rolloffFactor: _, ...x }) => {
    let E = c.createPanner();
    if (x.channelCount > 2 || x.channelCountMode === "max") throw i();
    ne(E, x);
    let D = { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "discrete" }, F = r(c, { ...D, channelInterpretation: "speakers", numberOfInputs: 6 }), q = n(c, { ...x, gain: 1 }), j = n(c, { ...D, gain: 1 }), L = n(c, { ...D, gain: 0 }), N = n(c, { ...D, gain: 0 }), S = n(c, { ...D, gain: 0 }), b = n(c, { ...D, gain: 0 }), M = n(c, { ...D, gain: 0 }), I = o(c, 256, 6, 1), R = s(c, { ...D, curve: new Float32Array([1, 1]), oversample: "none" }), $ = [T, f, g], Y = [k, w, A], ee = new Float32Array(1);
    I.onaudioprocess = ({ inputBuffer: G }) => {
      let Ut = [l(G, ee, 0), l(G, ee, 1), l(G, ee, 2)];
      Ut.some((ho, po) => ho !== $[po]) && (E.setOrientation(...Ut), $ = Ut);
      let ot = [l(G, ee, 3), l(G, ee, 4), l(G, ee, 5)];
      ot.some((ho, po) => ho !== Y[po]) && (E.setPosition(...ot), Y = ot);
    }, Object.defineProperty(L.gain, "defaultValue", { get: () => 0 }), Object.defineProperty(N.gain, "defaultValue", { get: () => 0 }), Object.defineProperty(S.gain, "defaultValue", { get: () => 0 }), Object.defineProperty(b.gain, "defaultValue", { get: () => 0 }), Object.defineProperty(M.gain, "defaultValue", { get: () => 0 });
    let W = { get bufferSize() {
    }, get channelCount() {
      return E.channelCount;
    }, set channelCount(G) {
      if (G > 2) throw i();
      q.channelCount = G, E.channelCount = G;
    }, get channelCountMode() {
      return E.channelCountMode;
    }, set channelCountMode(G) {
      if (G === "max") throw i();
      q.channelCountMode = G, E.channelCountMode = G;
    }, get channelInterpretation() {
      return E.channelInterpretation;
    }, set channelInterpretation(G) {
      q.channelInterpretation = G, E.channelInterpretation = G;
    }, get coneInnerAngle() {
      return E.coneInnerAngle;
    }, set coneInnerAngle(G) {
      E.coneInnerAngle = G;
    }, get coneOuterAngle() {
      return E.coneOuterAngle;
    }, set coneOuterAngle(G) {
      E.coneOuterAngle = G;
    }, get coneOuterGain() {
      return E.coneOuterGain;
    }, set coneOuterGain(G) {
      if (G < 0 || G > 1) throw e();
      E.coneOuterGain = G;
    }, get context() {
      return E.context;
    }, get distanceModel() {
      return E.distanceModel;
    }, set distanceModel(G) {
      E.distanceModel = G;
    }, get inputs() {
      return [q];
    }, get maxDistance() {
      return E.maxDistance;
    }, set maxDistance(G) {
      if (G < 0) throw new RangeError();
      E.maxDistance = G;
    }, get numberOfInputs() {
      return E.numberOfInputs;
    }, get numberOfOutputs() {
      return E.numberOfOutputs;
    }, get orientationX() {
      return j.gain;
    }, get orientationY() {
      return L.gain;
    }, get orientationZ() {
      return N.gain;
    }, get panningModel() {
      return E.panningModel;
    }, set panningModel(G) {
      E.panningModel = G;
    }, get positionX() {
      return S.gain;
    }, get positionY() {
      return b.gain;
    }, get positionZ() {
      return M.gain;
    }, get refDistance() {
      return E.refDistance;
    }, set refDistance(G) {
      if (G < 0) throw new RangeError();
      E.refDistance = G;
    }, get rolloffFactor() {
      return E.rolloffFactor;
    }, set rolloffFactor(G) {
      if (G < 0) throw new RangeError();
      E.rolloffFactor = G;
    }, addEventListener(...G) {
      return q.addEventListener(G[0], G[1], G[2]);
    }, dispatchEvent(...G) {
      return q.dispatchEvent(G[0]);
    }, removeEventListener(...G) {
      return q.removeEventListener(G[0], G[1], G[2]);
    } };
    h !== W.coneInnerAngle && (W.coneInnerAngle = h), p !== W.coneOuterAngle && (W.coneOuterAngle = p), d !== W.coneOuterGain && (W.coneOuterGain = d), m !== W.distanceModel && (W.distanceModel = m), y !== W.maxDistance && (W.maxDistance = y), T !== W.orientationX.value && (W.orientationX.value = T), f !== W.orientationY.value && (W.orientationY.value = f), g !== W.orientationZ.value && (W.orientationZ.value = g), v !== W.panningModel && (W.panningModel = v), k !== W.positionX.value && (W.positionX.value = k), w !== W.positionY.value && (W.positionY.value = w), A !== W.positionZ.value && (W.positionZ.value = A), C !== W.refDistance && (W.refDistance = C), _ !== W.rolloffFactor && (W.rolloffFactor = _), ($[0] !== 1 || $[1] !== 0 || $[2] !== 0) && E.setOrientation(...$), (Y[0] !== 0 || Y[1] !== 0 || Y[2] !== 0) && E.setPosition(...Y);
    let ie = () => {
      q.connect(E), t(q, R, 0, 0), R.connect(j).connect(F, 0, 0), R.connect(L).connect(F, 0, 1), R.connect(N).connect(F, 0, 2), R.connect(S).connect(F, 0, 3), R.connect(b).connect(F, 0, 4), R.connect(M).connect(F, 0, 5), F.connect(I).connect(c.destination);
    }, ge = () => {
      q.disconnect(E), a(q, R, 0, 0), R.disconnect(j), j.disconnect(F), R.disconnect(L), L.disconnect(F), R.disconnect(N), N.disconnect(F), R.disconnect(S), S.disconnect(F), R.disconnect(b), b.disconnect(F), R.disconnect(M), M.disconnect(F), F.disconnect(I), I.disconnect(c.destination);
    };
    return u(tr(W, E), ie, ge);
  };
  var zx = (t) => (e, { disableNormalization: r, imag: n, real: o }) => {
    let s = n instanceof Float32Array ? n : new Float32Array(n), i = o instanceof Float32Array ? o : new Float32Array(o), a = e.createPeriodicWave(i, s, { disableNormalization: r });
    if (Array.from(n).length < 2) throw t();
    return a;
  };
  var os = (t, e, r, n) => t.createScriptProcessor(e, r, n);
  var Wx = (t, e) => (r, n) => {
    let o = n.channelCountMode;
    if (o === "clamped-max") throw e();
    if (r.createStereoPanner === void 0) return t(r, n);
    let s = r.createStereoPanner();
    return ne(s, n), he(s, n, "pan"), Object.defineProperty(s, "channelCountMode", { get: () => o, set: (i) => {
      if (i !== o) throw e();
    } }), s;
  };
  var Bx = (t, e, r, n, o, s) => {
    let a = new Float32Array([1, 1]), l = Math.PI / 2, u = { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "discrete" }, c = { ...u, oversample: "none" }, h = (m, y, T, f) => {
      let g = new Float32Array(16385), v = new Float32Array(16385);
      for (let x = 0; x < 16385; x += 1) {
        let E = x / 16384 * l;
        g[x] = Math.cos(E), v[x] = Math.sin(E);
      }
      let k = r(m, { ...u, gain: 0 }), w = n(m, { ...c, curve: g }), A = n(m, { ...c, curve: a }), C = r(m, { ...u, gain: 0 }), _ = n(m, { ...c, curve: v });
      return { connectGraph() {
        y.connect(k), y.connect(A.inputs === void 0 ? A : A.inputs[0]), y.connect(C), A.connect(T), T.connect(w.inputs === void 0 ? w : w.inputs[0]), T.connect(_.inputs === void 0 ? _ : _.inputs[0]), w.connect(k.gain), _.connect(C.gain), k.connect(f, 0, 0), C.connect(f, 0, 1);
      }, disconnectGraph() {
        y.disconnect(k), y.disconnect(A.inputs === void 0 ? A : A.inputs[0]), y.disconnect(C), A.disconnect(T), T.disconnect(w.inputs === void 0 ? w : w.inputs[0]), T.disconnect(_.inputs === void 0 ? _ : _.inputs[0]), w.disconnect(k.gain), _.disconnect(C.gain), k.disconnect(f, 0, 0), C.disconnect(f, 0, 1);
      } };
    }, p = (m, y, T, f) => {
      let g = new Float32Array(16385), v = new Float32Array(16385), k = new Float32Array(16385), w = new Float32Array(16385), A = Math.floor(16385 / 2);
      for (let S = 0; S < 16385; S += 1) if (S > A) {
        let b = (S - A) / (16384 - A) * l;
        g[S] = Math.cos(b), v[S] = Math.sin(b), k[S] = 0, w[S] = 1;
      } else {
        let b = S / (16384 - A) * l;
        g[S] = 1, v[S] = 0, k[S] = Math.cos(b), w[S] = Math.sin(b);
      }
      let C = e(m, { channelCount: 2, channelCountMode: "explicit", channelInterpretation: "discrete", numberOfOutputs: 2 }), _ = r(m, { ...u, gain: 0 }), x = n(m, { ...c, curve: g }), E = r(m, { ...u, gain: 0 }), D = n(m, { ...c, curve: v }), F = n(m, { ...c, curve: a }), q = r(m, { ...u, gain: 0 }), j = n(m, { ...c, curve: k }), L = r(m, { ...u, gain: 0 }), N = n(m, { ...c, curve: w });
      return { connectGraph() {
        y.connect(C), y.connect(F.inputs === void 0 ? F : F.inputs[0]), C.connect(_, 0), C.connect(E, 0), C.connect(q, 1), C.connect(L, 1), F.connect(T), T.connect(x.inputs === void 0 ? x : x.inputs[0]), T.connect(D.inputs === void 0 ? D : D.inputs[0]), T.connect(j.inputs === void 0 ? j : j.inputs[0]), T.connect(N.inputs === void 0 ? N : N.inputs[0]), x.connect(_.gain), D.connect(E.gain), j.connect(q.gain), N.connect(L.gain), _.connect(f, 0, 0), q.connect(f, 0, 0), E.connect(f, 0, 1), L.connect(f, 0, 1);
      }, disconnectGraph() {
        y.disconnect(C), y.disconnect(F.inputs === void 0 ? F : F.inputs[0]), C.disconnect(_, 0), C.disconnect(E, 0), C.disconnect(q, 1), C.disconnect(L, 1), F.disconnect(T), T.disconnect(x.inputs === void 0 ? x : x.inputs[0]), T.disconnect(D.inputs === void 0 ? D : D.inputs[0]), T.disconnect(j.inputs === void 0 ? j : j.inputs[0]), T.disconnect(N.inputs === void 0 ? N : N.inputs[0]), x.disconnect(_.gain), D.disconnect(E.gain), j.disconnect(q.gain), N.disconnect(L.gain), _.disconnect(f, 0, 0), q.disconnect(f, 0, 0), E.disconnect(f, 0, 1), L.disconnect(f, 0, 1);
      } };
    }, d = (m, y, T, f, g) => {
      if (y === 1) return h(m, T, f, g);
      if (y === 2) return p(m, T, f, g);
      throw o();
    };
    return (m, { channelCount: y, channelCountMode: T, pan: f, ...g }) => {
      if (T === "max") throw o();
      let v = t(m, { ...g, channelCount: 1, channelCountMode: T, numberOfInputs: 2 }), k = r(m, { ...g, channelCount: y, channelCountMode: T, gain: 1 }), w = r(m, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "discrete", gain: f }), { connectGraph: A, disconnectGraph: C } = d(m, y, k, w, v);
      Object.defineProperty(w.gain, "defaultValue", { get: () => 0 }), Object.defineProperty(w.gain, "maxValue", { get: () => 1 }), Object.defineProperty(w.gain, "minValue", { get: () => -1 });
      let _ = { get bufferSize() {
      }, get channelCount() {
        return k.channelCount;
      }, set channelCount(F) {
        k.channelCount !== F && (x && C(), { connectGraph: A, disconnectGraph: C } = d(m, F, k, w, v), x && A()), k.channelCount = F;
      }, get channelCountMode() {
        return k.channelCountMode;
      }, set channelCountMode(F) {
        if (F === "clamped-max" || F === "max") throw o();
        k.channelCountMode = F;
      }, get channelInterpretation() {
        return k.channelInterpretation;
      }, set channelInterpretation(F) {
        k.channelInterpretation = F;
      }, get context() {
        return k.context;
      }, get inputs() {
        return [k];
      }, get numberOfInputs() {
        return k.numberOfInputs;
      }, get numberOfOutputs() {
        return k.numberOfOutputs;
      }, get pan() {
        return w.gain;
      }, addEventListener(...F) {
        return k.addEventListener(F[0], F[1], F[2]);
      }, dispatchEvent(...F) {
        return k.dispatchEvent(F[0]);
      }, removeEventListener(...F) {
        return k.removeEventListener(F[0], F[1], F[2]);
      } }, x = false, E = () => {
        A(), x = true;
      }, D = () => {
        C(), x = false;
      };
      return s(tr(_, v), E, D);
    };
  };
  var Ux = (t, e, r, n, o, s, i) => (a, l) => {
    let u = a.createWaveShaper();
    if (s !== null && s.name === "webkitAudioContext" && a.createGain().gain.automationRate === void 0) return r(a, l);
    ne(u, l);
    let c = l.curve === null || l.curve instanceof Float32Array ? l.curve : new Float32Array(l.curve);
    if (c !== null && c.length < 2) throw e();
    le(u, { curve: c }, "curve"), le(u, l, "oversample");
    let h = null, p = false;
    return i(u, "curve", (y) => () => y.call(u), (y) => (T) => (y.call(u, T), p && (n(T) && h === null ? h = t(a, u) : !n(T) && h !== null && (h(), h = null)), T)), o(u, () => {
      p = true, n(u.curve) && (h = t(a, u));
    }, () => {
      p = false, h !== null && (h(), h = null);
    });
  };
  var Gx = (t, e, r, n, o) => (s, { curve: i, oversample: a, ...l }) => {
    let u = s.createWaveShaper(), c = s.createWaveShaper();
    ne(u, l), ne(c, l);
    let h = r(s, { ...l, gain: 1 }), p = r(s, { ...l, gain: -1 }), d = r(s, { ...l, gain: 1 }), m = r(s, { ...l, gain: -1 }), y = null, T = false, f = null, g = { get bufferSize() {
    }, get channelCount() {
      return u.channelCount;
    }, set channelCount(w) {
      h.channelCount = w, p.channelCount = w, u.channelCount = w, d.channelCount = w, c.channelCount = w, m.channelCount = w;
    }, get channelCountMode() {
      return u.channelCountMode;
    }, set channelCountMode(w) {
      h.channelCountMode = w, p.channelCountMode = w, u.channelCountMode = w, d.channelCountMode = w, c.channelCountMode = w, m.channelCountMode = w;
    }, get channelInterpretation() {
      return u.channelInterpretation;
    }, set channelInterpretation(w) {
      h.channelInterpretation = w, p.channelInterpretation = w, u.channelInterpretation = w, d.channelInterpretation = w, c.channelInterpretation = w, m.channelInterpretation = w;
    }, get context() {
      return u.context;
    }, get curve() {
      return f;
    }, set curve(w) {
      if (w !== null && w.length < 2) throw e();
      if (w === null) u.curve = w, c.curve = w;
      else {
        let A = w.length, C = new Float32Array(A + 2 - A % 2), _ = new Float32Array(A + 2 - A % 2);
        C[0] = w[0], _[0] = -w[A - 1];
        let x = Math.ceil((A + 1) / 2), E = (A + 1) / 2 - 1;
        for (let D = 1; D < x; D += 1) {
          let F = D / x * E, q = Math.floor(F), j = Math.ceil(F);
          C[D] = q === j ? w[q] : (1 - (F - q)) * w[q] + (1 - (j - F)) * w[j], _[D] = q === j ? -w[A - 1 - q] : -((1 - (F - q)) * w[A - 1 - q]) - (1 - (j - F)) * w[A - 1 - j];
        }
        C[x] = A % 2 === 1 ? w[x - 1] : (w[x - 2] + w[x - 1]) / 2, u.curve = C, c.curve = _;
      }
      f = w, T && (n(f) && y === null ? y = t(s, h) : y !== null && (y(), y = null));
    }, get inputs() {
      return [h];
    }, get numberOfInputs() {
      return u.numberOfInputs;
    }, get numberOfOutputs() {
      return u.numberOfOutputs;
    }, get oversample() {
      return u.oversample;
    }, set oversample(w) {
      u.oversample = w, c.oversample = w;
    }, addEventListener(...w) {
      return h.addEventListener(w[0], w[1], w[2]);
    }, dispatchEvent(...w) {
      return h.dispatchEvent(w[0]);
    }, removeEventListener(...w) {
      return h.removeEventListener(w[0], w[1], w[2]);
    } };
    i !== null && (g.curve = i instanceof Float32Array ? i : new Float32Array(i)), a !== g.oversample && (g.oversample = a);
    let v = () => {
      h.connect(u).connect(d), h.connect(p).connect(c).connect(m).connect(d), T = true, n(f) && (y = t(s, h));
    }, k = () => {
      h.disconnect(u), u.disconnect(d), h.disconnect(p), p.disconnect(c), c.disconnect(m), m.disconnect(d), T = false, y !== null && (y(), y = null);
    };
    return o(tr(g, d), v, k);
  };
  var rt = () => new DOMException("", "NotSupportedError");
  var Q1 = { numberOfChannels: 1 }, Qx = (t, e, r, n, o) => class extends t {
    constructor(i, a, l) {
      let u;
      if (typeof i == "number" && a !== void 0 && l !== void 0) u = { length: a, numberOfChannels: i, sampleRate: l };
      else if (typeof i == "object") u = i;
      else throw new Error("The given parameters are not valid.");
      let { length: c, numberOfChannels: h, sampleRate: p } = { ...Q1, ...u }, d = n(h, c, p);
      e(mr, () => mr(d)) || d.addEventListener("statechange", /* @__PURE__ */ (() => {
        let m = 0, y = (T) => {
          this._state === "running" && (m > 0 ? (d.removeEventListener("statechange", y), T.stopImmediatePropagation(), this._waitForThePromiseToSettle(T)) : m += 1);
        };
        return y;
      })()), super(d, h), this._length = c, this._nativeOfflineAudioContext = d, this._state = null;
    }
    get length() {
      return this._nativeOfflineAudioContext.length === void 0 ? this._length : this._nativeOfflineAudioContext.length;
    }
    get state() {
      return this._state === null ? this._nativeOfflineAudioContext.state : this._state;
    }
    startRendering() {
      return this._state === "running" ? Promise.reject(r()) : (this._state = "running", o(this.destination, this._nativeOfflineAudioContext).finally(() => {
        this._state = null, bn(this);
      }));
    }
    _waitForThePromiseToSettle(i) {
      this._state === null ? this._nativeOfflineAudioContext.dispatchEvent(i) : setTimeout(() => this._waitForThePromiseToSettle(i));
    }
  };
  var H1 = { channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers", detune: 0, frequency: 440, periodicWave: void 0, type: "sine" }, Hx = (t, e, r, n, o, s, i) => class extends t {
    constructor(l, u) {
      let c = o(l), h = { ...H1, ...u }, p = r(c, h), d = s(c), m = d ? n() : null, y = l.sampleRate / 2;
      super(l, false, p, m), this._detune = e(this, d, p.detune, 153600, -153600), this._frequency = e(this, d, p.frequency, y, -y), this._nativeOscillatorNode = p, this._onended = null, this._oscillatorNodeRenderer = m, this._oscillatorNodeRenderer !== null && h.periodicWave !== void 0 && (this._oscillatorNodeRenderer.periodicWave = h.periodicWave);
    }
    get detune() {
      return this._detune;
    }
    get frequency() {
      return this._frequency;
    }
    get onended() {
      return this._onended;
    }
    set onended(l) {
      let u = typeof l == "function" ? i(this, l) : null;
      this._nativeOscillatorNode.onended = u;
      let c = this._nativeOscillatorNode.onended;
      this._onended = c !== null && c === u ? l : c;
    }
    get type() {
      return this._nativeOscillatorNode.type;
    }
    set type(l) {
      this._nativeOscillatorNode.type = l, this._oscillatorNodeRenderer !== null && (this._oscillatorNodeRenderer.periodicWave = null);
    }
    setPeriodicWave(l) {
      this._nativeOscillatorNode.setPeriodicWave(l), this._oscillatorNodeRenderer !== null && (this._oscillatorNodeRenderer.periodicWave = l);
    }
    start(l = 0) {
      if (this._nativeOscillatorNode.start(l), this._oscillatorNodeRenderer !== null && (this._oscillatorNodeRenderer.start = l), this.context.state !== "closed") {
        fr(this);
        let u = () => {
          this._nativeOscillatorNode.removeEventListener("ended", u), _t(this) && Dr(this);
        };
        this._nativeOscillatorNode.addEventListener("ended", u);
      }
    }
    stop(l = 0) {
      this._nativeOscillatorNode.stop(l), this._oscillatorNodeRenderer !== null && (this._oscillatorNodeRenderer.stop = l);
    }
  };
  var $x = (t, e, r, n, o) => () => {
    let s = /* @__PURE__ */ new WeakMap(), i = null, a = null, l = null, u = async (c, h) => {
      let p = r(c), d = ae(p, h);
      if (!d) {
        let m = { channelCount: p.channelCount, channelCountMode: p.channelCountMode, channelInterpretation: p.channelInterpretation, detune: p.detune.value, frequency: p.frequency.value, periodicWave: i === null ? void 0 : i, type: p.type };
        p = e(h, m), a !== null && p.start(a), l !== null && p.stop(l);
      }
      return s.set(h, p), d ? (await t(h, c.detune, p.detune), await t(h, c.frequency, p.frequency)) : (await n(h, c.detune, p.detune), await n(h, c.frequency, p.frequency)), await o(c, h, p), p;
    };
    return { set periodicWave(c) {
      i = c;
    }, set start(c) {
      a = c;
    }, set stop(c) {
      l = c;
    }, render(c, h) {
      let p = s.get(h);
      return p !== void 0 ? Promise.resolve(p) : u(c, h);
    } };
  };
  var $1 = { channelCount: 2, channelCountMode: "clamped-max", channelInterpretation: "speakers", coneInnerAngle: 360, coneOuterAngle: 360, coneOuterGain: 0, distanceModel: "inverse", maxDistance: 1e4, orientationX: 1, orientationY: 0, orientationZ: 0, panningModel: "equalpower", positionX: 0, positionY: 0, positionZ: 0, refDistance: 1, rolloffFactor: 1 }, Yx = (t, e, r, n, o, s, i) => class extends t {
    constructor(l, u) {
      let c = o(l), h = { ...$1, ...u }, p = r(c, h), d = s(c), m = d ? n() : null;
      super(l, false, p, m), this._nativePannerNode = p, this._orientationX = e(this, d, p.orientationX, De, Re), this._orientationY = e(this, d, p.orientationY, De, Re), this._orientationZ = e(this, d, p.orientationZ, De, Re), this._positionX = e(this, d, p.positionX, De, Re), this._positionY = e(this, d, p.positionY, De, Re), this._positionZ = e(this, d, p.positionZ, De, Re), i(this, 1);
    }
    get coneInnerAngle() {
      return this._nativePannerNode.coneInnerAngle;
    }
    set coneInnerAngle(l) {
      this._nativePannerNode.coneInnerAngle = l;
    }
    get coneOuterAngle() {
      return this._nativePannerNode.coneOuterAngle;
    }
    set coneOuterAngle(l) {
      this._nativePannerNode.coneOuterAngle = l;
    }
    get coneOuterGain() {
      return this._nativePannerNode.coneOuterGain;
    }
    set coneOuterGain(l) {
      this._nativePannerNode.coneOuterGain = l;
    }
    get distanceModel() {
      return this._nativePannerNode.distanceModel;
    }
    set distanceModel(l) {
      this._nativePannerNode.distanceModel = l;
    }
    get maxDistance() {
      return this._nativePannerNode.maxDistance;
    }
    set maxDistance(l) {
      this._nativePannerNode.maxDistance = l;
    }
    get orientationX() {
      return this._orientationX;
    }
    get orientationY() {
      return this._orientationY;
    }
    get orientationZ() {
      return this._orientationZ;
    }
    get panningModel() {
      return this._nativePannerNode.panningModel;
    }
    set panningModel(l) {
      this._nativePannerNode.panningModel = l;
    }
    get positionX() {
      return this._positionX;
    }
    get positionY() {
      return this._positionY;
    }
    get positionZ() {
      return this._positionZ;
    }
    get refDistance() {
      return this._nativePannerNode.refDistance;
    }
    set refDistance(l) {
      this._nativePannerNode.refDistance = l;
    }
    get rolloffFactor() {
      return this._nativePannerNode.rolloffFactor;
    }
    set rolloffFactor(l) {
      this._nativePannerNode.rolloffFactor = l;
    }
  };
  var Xx = (t, e, r, n, o, s, i, a, l, u) => () => {
    let c = /* @__PURE__ */ new WeakMap(), h = null, p = async (d, m) => {
      let y = null, T = s(d), f = { channelCount: T.channelCount, channelCountMode: T.channelCountMode, channelInterpretation: T.channelInterpretation }, g = { ...f, coneInnerAngle: T.coneInnerAngle, coneOuterAngle: T.coneOuterAngle, coneOuterGain: T.coneOuterGain, distanceModel: T.distanceModel, maxDistance: T.maxDistance, panningModel: T.panningModel, refDistance: T.refDistance, rolloffFactor: T.rolloffFactor }, v = ae(T, m);
      if ("bufferSize" in T) y = n(m, { ...f, gain: 1 });
      else if (!v) {
        let k = { ...g, orientationX: T.orientationX.value, orientationY: T.orientationY.value, orientationZ: T.orientationZ.value, positionX: T.positionX.value, positionY: T.positionY.value, positionZ: T.positionZ.value };
        T = o(m, k);
      }
      if (c.set(m, y === null ? T : y), y !== null) {
        if (h === null) {
          if (i === null) throw new Error("Missing the native OfflineAudioContext constructor.");
          let D = new i(6, d.context.length, m.sampleRate), F = e(D, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers", numberOfInputs: 6 });
          F.connect(D.destination), h = (async () => {
            let q = await Promise.all([d.orientationX, d.orientationY, d.orientationZ, d.positionX, d.positionY, d.positionZ].map(async (j, L) => {
              let N = r(D, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "discrete", offset: L === 0 ? 1 : 0 });
              return await a(D, j, N.offset), N;
            }));
            for (let j = 0; j < 6; j += 1) q[j].connect(F, 0, j), q[j].start(0);
            return u(D);
          })();
        }
        let k = await h, w = n(m, { ...f, gain: 1 });
        await l(d, m, w);
        let A = [];
        for (let D = 0; D < k.numberOfChannels; D += 1) A.push(k.getChannelData(D));
        let C = [A[0][0], A[1][0], A[2][0]], _ = [A[3][0], A[4][0], A[5][0]], x = n(m, { ...f, gain: 1 }), E = o(m, { ...g, orientationX: C[0], orientationY: C[1], orientationZ: C[2], positionX: _[0], positionY: _[1], positionZ: _[2] });
        w.connect(x).connect(E.inputs[0]), E.connect(y);
        for (let D = 128; D < k.length; D += 128) {
          let F = [A[0][D], A[1][D], A[2][D]], q = [A[3][D], A[4][D], A[5][D]];
          if (F.some((j, L) => j !== C[L]) || q.some((j, L) => j !== _[L])) {
            C = F, _ = q;
            let j = D / m.sampleRate;
            x.gain.setValueAtTime(0, j), x = n(m, { ...f, gain: 0 }), E = o(m, { ...g, orientationX: C[0], orientationY: C[1], orientationZ: C[2], positionX: _[0], positionY: _[1], positionZ: _[2] }), x.gain.setValueAtTime(1, j), w.connect(x).connect(E.inputs[0]), E.connect(y);
          }
        }
        return y;
      }
      return v ? (await t(m, d.orientationX, T.orientationX), await t(m, d.orientationY, T.orientationY), await t(m, d.orientationZ, T.orientationZ), await t(m, d.positionX, T.positionX), await t(m, d.positionY, T.positionY), await t(m, d.positionZ, T.positionZ)) : (await a(m, d.orientationX, T.orientationX), await a(m, d.orientationY, T.orientationY), await a(m, d.orientationZ, T.orientationZ), await a(m, d.positionX, T.positionX), await a(m, d.positionY, T.positionY), await a(m, d.positionZ, T.positionZ)), er(T) ? await l(d, m, T.inputs[0]) : await l(d, m, T), T;
    };
    return { render(d, m) {
      let y = c.get(m);
      return y !== void 0 ? Promise.resolve(y) : p(d, m);
    } };
  };
  var Y1 = { disableNormalization: false }, Zx = (t, e, r, n) => class Kx {
    constructor(s, i) {
      let a = e(s), l = n({ ...Y1, ...i }), u = t(a, l);
      return r.add(u), u;
    }
    static [Symbol.hasInstance](s) {
      return s !== null && typeof s == "object" && Object.getPrototypeOf(s) === Kx.prototype || r.has(s);
    }
  };
  var Jx = (t, e) => (r, n, o) => (t(n).replay(o), e(n, r, o));
  var ey = (t, e, r) => async (n, o, s) => {
    let i = t(n);
    await Promise.all(i.activeInputs.map((a, l) => Array.from(a).map(async ([u, c]) => {
      let p = await e(u).render(u, o), d = n.context.destination;
      !r(u) && (n !== d || !r(n)) && p.connect(s, c, l);
    })).reduce((a, l) => [...a, ...l], []));
  };
  var ty = (t, e, r) => async (n, o, s) => {
    let i = e(n);
    await Promise.all(Array.from(i.activeInputs).map(async ([a, l]) => {
      let c = await t(a).render(a, o);
      r(a) || c.connect(s, l);
    }));
  };
  var ry = (t, e, r, n) => (o) => t(mr, () => mr(o)) ? Promise.resolve(t(n, n)).then((s) => {
    if (!s) {
      let i = r(o, 512, 0, 1);
      o.oncomplete = () => {
        i.onaudioprocess = null, i.disconnect();
      }, i.onaudioprocess = () => o.currentTime, i.connect(o.destination);
    }
    return o.startRendering();
  }) : new Promise((s) => {
    let i = e(o, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "discrete", gain: 0 });
    o.oncomplete = (a) => {
      i.disconnect(), s(a.renderedBuffer);
    }, i.connect(o.destination), o.startRendering();
  });
  var ny = (t) => (e, r) => {
    t.set(e, r);
  };
  var oy = (t) => (e, r) => t.set(e, r);
  var sy = (t, e, r, n, o, s, i, a) => (l, u) => r(l).render(l, u).then(() => Promise.all(Array.from(n(u)).map((c) => r(c).render(c, u)))).then(() => o(u)).then((c) => (typeof c.copyFromChannel != "function" ? (i(c), Ho(c)) : e(s, () => s(c)) || a(c), t.add(c), c));
  var X1 = { channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers", pan: 0 }, iy = (t, e, r, n, o, s) => class extends t {
    constructor(a, l) {
      let u = o(a), c = { ...X1, ...l }, h = r(u, c), p = s(u), d = p ? n() : null;
      super(a, false, h, d), this._pan = e(this, p, h.pan);
    }
    get pan() {
      return this._pan;
    }
  };
  var ay = (t, e, r, n, o) => () => {
    let s = /* @__PURE__ */ new WeakMap(), i = async (a, l) => {
      let u = r(a), c = ae(u, l);
      if (!c) {
        let h = { channelCount: u.channelCount, channelCountMode: u.channelCountMode, channelInterpretation: u.channelInterpretation, pan: u.pan.value };
        u = e(l, h);
      }
      return s.set(l, u), c ? await t(l, a.pan, u.pan) : await n(l, a.pan, u.pan), er(u) ? await o(a, l, u.inputs[0]) : await o(a, l, u), u;
    };
    return { render(a, l) {
      let u = s.get(l);
      return u !== void 0 ? Promise.resolve(u) : i(a, l);
    } };
  };
  var ly = (t) => () => {
    if (t === null) return false;
    try {
      new t({ length: 1, sampleRate: 44100 });
    } catch {
      return false;
    }
    return true;
  };
  var uy = (t, e) => async () => {
    if (t === null) return true;
    if (e === null) return false;
    let r = new Blob(['class A extends AudioWorkletProcessor{process(i){this.port.postMessage(i,[i[0][0].buffer])}}registerProcessor("a",A)'], { type: "application/javascript; charset=utf-8" }), n = new e(1, 128, 44100), o = URL.createObjectURL(r), s = false, i = false;
    try {
      await n.audioWorklet.addModule(o);
      let a = new t(n, "a", { numberOfOutputs: 0 }), l = n.createOscillator();
      a.port.onmessage = () => s = true, a.onprocessorerror = () => i = true, l.connect(a), l.start(0), await n.startRendering(), await new Promise((u) => setTimeout(u));
    } catch {
    } finally {
      URL.revokeObjectURL(o);
    }
    return s && !i;
  };
  var cy = (t, e) => () => {
    if (e === null) return Promise.resolve(false);
    let r = new e(1, 1, 44100), n = t(r, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "discrete", gain: 0 });
    return new Promise((o) => {
      r.oncomplete = () => {
        n.disconnect(), o(r.currentTime !== 0);
      }, r.startRendering();
    });
  };
  var qh = () => new DOMException("", "UnknownError");
  var Z1 = { channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers", curve: null, oversample: "none" }, hy = (t, e, r, n, o, s, i) => class extends t {
    constructor(l, u) {
      let c = o(l), h = { ...Z1, ...u }, p = r(c, h), m = s(c) ? n() : null;
      super(l, true, p, m), this._isCurveNullified = false, this._nativeWaveShaperNode = p, i(this, 1);
    }
    get curve() {
      return this._isCurveNullified ? null : this._nativeWaveShaperNode.curve;
    }
    set curve(l) {
      if (l === null) this._isCurveNullified = true, this._nativeWaveShaperNode.curve = new Float32Array([0, 0]);
      else {
        if (l.length < 2) throw e();
        this._isCurveNullified = false, this._nativeWaveShaperNode.curve = l;
      }
    }
    get oversample() {
      return this._nativeWaveShaperNode.oversample;
    }
    set oversample(l) {
      this._nativeWaveShaperNode.oversample = l;
    }
  };
  var py = (t, e, r) => () => {
    let n = /* @__PURE__ */ new WeakMap(), o = async (s, i) => {
      let a = e(s);
      if (!ae(a, i)) {
        let u = { channelCount: a.channelCount, channelCountMode: a.channelCountMode, channelInterpretation: a.channelInterpretation, curve: a.curve, oversample: a.oversample };
        a = t(i, u);
      }
      return n.set(i, a), er(a) ? await r(s, i, a.inputs[0]) : await r(s, i, a), a;
    };
    return { render(s, i) {
      let a = n.get(i);
      return a !== void 0 ? Promise.resolve(a) : o(s, i);
    } };
  };
  var fy = () => typeof window > "u" ? null : window;
  var dy = (t, e) => (r) => {
    r.copyFromChannel = (n, o, s = 0) => {
      let i = t(s), a = t(o);
      if (a >= r.numberOfChannels) throw e();
      let l = r.length, u = r.getChannelData(a), c = n.length;
      for (let h = i < 0 ? -i : 0; h + i < l && h < c; h += 1) n[h] = u[h + i];
    }, r.copyToChannel = (n, o, s = 0) => {
      let i = t(s), a = t(o);
      if (a >= r.numberOfChannels) throw e();
      let l = r.length, u = r.getChannelData(a), c = n.length;
      for (let h = i < 0 ? -i : 0; h + i < l && h < c; h += 1) u[h + i] = n[h];
    };
  };
  var my = (t) => (e) => {
    e.copyFromChannel = /* @__PURE__ */ ((r) => (n, o, s = 0) => {
      let i = t(s), a = t(o);
      if (i < e.length) return r.call(e, n, a, i);
    })(e.copyFromChannel), e.copyToChannel = /* @__PURE__ */ ((r) => (n, o, s = 0) => {
      let i = t(s), a = t(o);
      if (i < e.length) return r.call(e, n, a, i);
    })(e.copyToChannel);
  };
  var gy = (t) => (e, r) => {
    let n = r.createBuffer(1, 1, 44100);
    e.buffer === null && (e.buffer = n), t(e, "buffer", (o) => () => {
      let s = o.call(e);
      return s === n ? null : s;
    }, (o) => (s) => o.call(e, s === null ? n : s));
  };
  var _y = (t, e) => (r, n) => {
    n.channelCount = 1, n.channelCountMode = "explicit", Object.defineProperty(n, "channelCount", { get: () => 1, set: () => {
      throw t();
    } }), Object.defineProperty(n, "channelCountMode", { get: () => "explicit", set: () => {
      throw t();
    } });
    let o = r.createBufferSource();
    e(n, () => {
      let a = n.numberOfInputs;
      for (let l = 0; l < a; l += 1) o.connect(n, 0, l);
    }, () => o.disconnect(n));
  };
  var jh = (t, e, r) => t.copyFromChannel === void 0 ? t.getChannelData(r)[0] : (t.copyFromChannel(e, r), e[0]);
  var zh = (t) => {
    if (t === null) return false;
    let e = t.length;
    return e % 2 !== 0 ? t[Math.floor(e / 2)] !== 0 : t[e / 2 - 1] + t[e / 2] !== 0;
  };
  var ss = (t, e, r, n) => {
    let o = t;
    for (; !o.hasOwnProperty(e); ) o = Object.getPrototypeOf(o);
    let { get: s, set: i } = Object.getOwnPropertyDescriptor(o, e);
    Object.defineProperty(t, e, { get: r(s), set: n(i) });
  };
  var xy = (t) => ({ ...t, outputChannelCount: t.outputChannelCount !== void 0 ? t.outputChannelCount : t.numberOfInputs === 1 && t.numberOfOutputs === 1 ? [t.channelCount] : Array.from({ length: t.numberOfOutputs }, () => 1) });
  var yy = (t) => ({ ...t, channelCount: t.numberOfOutputs });
  var vy = (t) => {
    let { imag: e, real: r } = t;
    return e === void 0 ? r === void 0 ? { ...t, imag: [0, 0], real: [0, 0] } : { ...t, imag: Array.from(r, () => 0), real: r } : r === void 0 ? { ...t, imag: e, real: Array.from(e, () => 0) } : { ...t, imag: e, real: r };
  };
  var Wh = (t, e, r) => {
    try {
      t.setValueAtTime(e, r);
    } catch (n) {
      if (n.code !== 9) throw n;
      Wh(t, e, r + 1e-7);
    }
  };
  var wy = (t) => {
    let e = t.createBufferSource();
    e.start();
    try {
      e.start();
    } catch {
      return true;
    }
    return false;
  };
  var Sy = (t) => {
    let e = t.createBufferSource(), r = t.createBuffer(1, 1, 44100);
    e.buffer = r;
    try {
      e.start(0, 1);
    } catch {
      return false;
    }
    return true;
  };
  var Ty = (t) => {
    let e = t.createBufferSource();
    e.start();
    try {
      e.stop();
    } catch {
      return false;
    }
    return true;
  };
  var Nl = (t) => {
    let e = t.createOscillator();
    try {
      e.start(-1);
    } catch (r) {
      return r instanceof RangeError;
    }
    return false;
  };
  var Bh = (t) => {
    let e = t.createBuffer(1, 1, 44100), r = t.createBufferSource();
    r.buffer = e, r.start(), r.stop();
    try {
      return r.stop(), true;
    } catch {
      return false;
    }
  };
  var Ol = (t) => {
    let e = t.createOscillator();
    try {
      e.stop(-1);
    } catch (r) {
      return r instanceof RangeError;
    }
    return false;
  };
  var Ay = (t) => {
    let { port1: e, port2: r } = new MessageChannel();
    try {
      e.postMessage(t);
    } finally {
      e.close(), r.close();
    }
  };
  var ky = (t) => {
    t.start = /* @__PURE__ */ ((e) => (r = 0, n = 0, o) => {
      let s = t.buffer, i = s === null ? n : Math.min(s.duration, n);
      s !== null && i > s.duration - 0.5 / t.context.sampleRate ? e.call(t, r, 0, 0) : e.call(t, r, i, o);
    })(t.start);
  };
  var Uh = (t, e) => {
    let r = e.createGain();
    t.connect(r);
    let n = /* @__PURE__ */ ((o) => () => {
      o.call(t, r), t.removeEventListener("ended", n);
    })(t.disconnect);
    t.addEventListener("ended", n), tr(t, r), t.stop = /* @__PURE__ */ ((o) => {
      let s = false;
      return (i = 0) => {
        if (s) try {
          o.call(t, i);
        } catch {
          r.gain.setValueAtTime(0, i);
        }
        else o.call(t, i), s = true;
      };
    })(t.stop);
  };
  var ro = (t, e) => (r) => {
    let n = { value: t };
    return Object.defineProperties(r, { currentTarget: n, target: n }), typeof e == "function" ? e.call(t, r) : e.handleEvent.call(t, r);
  };
  var K1 = dg(dr), J1 = Ag(dr), eS = v_(On), Ny = /* @__PURE__ */ new WeakMap(), tS = P_(Ny), rr = t_(/* @__PURE__ */ new Map(), /* @__PURE__ */ new WeakMap()), Mr = fy(), Oy = hx(rr, Jt), Gh = I_(He), nt = ey(He, Gh, Xr), rS = Og(Oy, de, nt), ye = q_(Go), Zr = Vx(Mr), me = ex(Zr), Ey = /* @__PURE__ */ new WeakMap(), by = E_(ro), is = mx(Mr), Qh = X_(is), Hh = Z_(Mr), Dy = K_(Mr), Fi = _x(Mr), Fe = Gg(mg(ml), Tg(K1, J1, $o, eS, Yo, He, tS, br, de, dr, _t, Xr, Xo), rr, G_(bi, Yo, He, de, eo, _t), Jt, es, rt, __($o, bi, He, de, eo, ye, _t, me), T_(Ey, He, qe), by, ye, Qh, Hh, Dy, me, Fi), nS = Ng(Fe, rS, Jt, Oy, ye, me);
  var $h = /* @__PURE__ */ new WeakSet(), Cy = px(Mr), My = h_(new Uint32Array(1)), Yh = dy(My, Jt), Xh = my(My), Zh = Eg($h, rr, rt, Cy, Zr, ly(Cy), Yh, Xh);
  var El = kg(xt), Ry = ty(Gh, En, Xr), Rr = i_(Ry), as = dx(El, rr, wy, Sy, Ty, Nl, Bh, Ol, ky, gy(ss), Uh), Fr = Jx(V_(En), Ry), oS = Mg(Rr, as, de, Fr, nt), gr = Hg(gg(gl), Ey, Ei, $g, Et.createCancelAndHoldAutomationEvent, Et.createCancelScheduledValuesAutomationEvent, Et.createExponentialRampToValueAutomationEvent, Et.createLinearRampToValueAutomationEvent, Et.createSetTargetAutomationEvent, Et.createSetValueAutomationEvent, Et.createSetValueCurveAutomationEvent, is, Wh), sS = Dg(Fe, oS, gr, Te, as, ye, me, ro);
  var iS = jg(Fe, zg, Jt, Te, gx(xt, ss), ye, me, nt), aS = e_(Rr, Vh, de, Fr, nt), no = oy(Ny), lS = Jg(Fe, gr, aS, es, Vh, ye, me, no), Mn = ux(dr, Hh), uS = _y(Te, Mn), Rn = Ax(is, uS), cS = n_(Rn, de, nt), hS = r_(Fe, cS, Rn, ye, me), pS = s_(ns, de, nt), fS = o_(Fe, pS, ns, ye, me, yy), dS = Nx(El, as, xt, Mn), ls = Cx(El, rr, dS, Nl, Ol), mS = c_(Rr, ls, de, Fr, nt), gS = u_(Fe, gr, mS, ls, ye, me, ro), Fy = Ox(rt, ss), _S = f_(Fy, de, nt), xS = p_(Fe, _S, Fy, ye, me, no), yS = y_(Rr, Lh, de, Fr, nt), vS = x_(Fe, gr, yS, Lh, ye, me, no), Iy = Ex(rt), wS = C_(Rr, Iy, de, Fr, nt), SS = k_(Fe, gr, wS, Iy, rt, ye, me, no), TS = R_(Rr, xt, de, Fr, nt), AS = M_(Fe, gr, TS, xt, ye, me), kS = Mx(es, Te, os, rt), bl = ry(rr, xt, os, cy(xt, Zr)), CS = U_(as, de, Zr, nt, bl), NS = bx(kS), OS = B_(Fe, NS, CS, ye, me, no), ES = Wg(gr, Rn, ls, os, rt, jh, me, ss), Py = /* @__PURE__ */ new WeakMap(), Kh = ax(iS, ES, by, me, Py, ro), Vy = Lx(El, rr, Nl, Bh, Ol, Uh), bS = $x(Rr, Vy, de, Fr, nt), DS = Hx(Fe, gr, Vy, bS, ye, me, ro), Ly = l_(as), MS = Gx(Ly, Te, xt, zh, Mn), Dl = Ux(Ly, Te, MS, zh, Mn, is, ss), RS = jx($o, Te, Rn, xt, os, Dl, rt, Yo, jh, Mn), qy = qx(RS), FS = Xx(Rr, Rn, ls, xt, qy, de, Zr, Fr, nt, bl), IS = Yx(Fe, gr, qy, FS, ye, me, no), PS = zx(Jt), VS = Zx(PS, ye, /* @__PURE__ */ new WeakSet(), vy), LS = Bx(Rn, ns, xt, Dl, rt, Mn), jy = Wx(LS, rt), qS = ay(Rr, jy, de, Fr, nt), jS = iy(Fe, gr, jy, qS, ye, me), zS = py(Dl, de, nt), WS = hy(Fe, Te, Dl, zS, ye, me, no), zy = tx(Mr), Jh = b_(Mr), Wy = /* @__PURE__ */ new WeakMap(), BS = j_(Wy, Zr), US = zy ? Sg(rr, rt, O_(Mr), Jh, D_(fg), ye, BS, me, Fi, /* @__PURE__ */ new WeakMap(), /* @__PURE__ */ new WeakMap(), uy(Fi, Zr), Mr) : void 0, GS = J_(Qh, me), QS = g_($h, rr, m_, N_, /* @__PURE__ */ new WeakSet(), ye, GS, Qo, mr, Yh, Xh), By = Kg(US, nS, Zh, sS, lS, hS, fS, gS, xS, QS, vS, SS, AS, OS, Kh, DS, IS, VS, jS, WS), HS = rx(Fe, Rx, ye, me), $S = nx(Fe, Fx, ye, me), YS = ox(Fe, Ix, ye, me), XS = Px(Te, me), ZS = sx(Fe, XS, ye), Uy = qg(By, Te, rt, qh, HS, $S, YS, ZS, is);
  var ep = z_(Py), KS = Cg(ep), Gy = a_(Jt), JS = w_(ep), Qy = A_(Jt), Hy = /* @__PURE__ */ new WeakMap(), eT = F_(Hy, qe), tT = Tx(Gy, Jt, Te, Rn, ns, ls, xt, os, rt, Qy, Jh, eT, Mn), rT = yx(Te, tT, xt, rt, Mn), nT = Zg(Rr, Gy, as, Rn, ns, ls, xt, JS, Qy, Jh, de, Fi, Zr, Fr, nt, bl), oT = L_(Wy), sT = ny(Hy), tp = zy ? Yg(KS, Fe, gr, nT, rT, He, oT, ye, me, Fi, xy, sT, Ay, ro) : void 0;
  var oB = ix(Te, rt, qh, Kh, is);
  var $y = d_(rt, Zr), Yy = sy($h, rr, Gh, ep, bl, Qo, Yh, Xh), sB = lx(rr, Te, $y, Kh, Yy);
  var Xy = Qx(By, rr, Te, $y, Yy);
  var Zy = Q_(Go, Qh), Ky = H_(Uo, Hh), Jy = $_(Ei, Dy), ev = Y_(Go, me);
  function Ie(t) {
    return t === void 0;
  }
  function X(t) {
    return t !== void 0;
  }
  function tv(t) {
    return typeof t == "function";
  }
  function yt(t) {
    return typeof t == "number";
  }
  function _r(t) {
    return Object.prototype.toString.call(t) === "[object Object]" && t.constructor === Object;
  }
  function rp(t) {
    return typeof t == "boolean";
  }
  function Pe(t) {
    return Array.isArray(t);
  }
  function ct(t) {
    return typeof t == "string";
  }
  function Ii(t) {
    return ct(t) && /^([a-g]{1}(?:b|#|x|bb)?)(-?[0-9]+)/i.test(t);
  }
  function Q(t, e) {
    if (!t) throw new Error(e);
  }
  function Ke(t, e, r = 1 / 0) {
    if (!(e <= t && t <= r)) throw new RangeError(`Value must be within [${e}, ${r}], got: ${t}`);
  }
  function Ml(t) {
    !t.isOffline && t.state !== "running" && us('The AudioContext is "suspended". Invoke Tone.start() from a user action to start the audio.');
  }
  var nv = false, rv = false;
  function np(t) {
    nv = t;
  }
  function ov(t) {
    Ie(t) && nv && !rv && (rv = true, us("Events scheduled inside of scheduled callbacks should use the passed in scheduling time. See https://github.com/Tonejs/Tone.js/wiki/Accurate-Timing"));
  }
  var sv = console;
  function iv(...t) {
    sv.log(...t);
  }
  function us(...t) {
    sv.warn(...t);
  }
  function av(t) {
    return new Uy(t);
  }
  function lv(t, e, r) {
    return new Xy(t, e, r);
  }
  var ht = typeof self == "object" ? self : null, uv = ht && (ht.hasOwnProperty("AudioContext") || ht.hasOwnProperty("webkitAudioContext"));
  function cv(t, e, r) {
    return Q(X(tp), "AudioWorkletNode only works in a secure context (https or localhost)"), new (t instanceof ht?.BaseAudioContext ? ht?.AudioWorkletNode : tp)(t, e, r);
  }
  function pt(t, e, r, n) {
    var o = arguments.length, s = o < 3 ? e : n === null ? n = Object.getOwnPropertyDescriptor(e, r) : n, i;
    if (typeof Reflect == "object" && typeof Reflect.decorate == "function") s = Reflect.decorate(t, e, r, n);
    else for (var a = t.length - 1; a >= 0; a--) (i = t[a]) && (s = (o < 3 ? i(s) : o > 3 ? i(e, r, s) : i(e, r)) || s);
    return o > 3 && s && Object.defineProperty(e, r, s), s;
  }
  function oe(t, e, r, n) {
    function o(s) {
      return s instanceof r ? s : new r(function(i) {
        i(s);
      });
    }
    return new (r || (r = Promise))(function(s, i) {
      function a(c) {
        try {
          u(n.next(c));
        } catch (h) {
          i(h);
        }
      }
      function l(c) {
        try {
          u(n.throw(c));
        } catch (h) {
          i(h);
        }
      }
      function u(c) {
        c.done ? s(c.value) : o(c.value).then(a, l);
      }
      u((n = n.apply(t, e || [])).next());
    });
  }
  var Rl = class {
    constructor(e, r, n, o) {
      this._callback = e, this._type = r, this._minimumUpdateInterval = Math.max(128 / (o || 44100), 1e-3), this.updateInterval = n, this._createClock();
    }
    _createWorker() {
      let e = new Blob([`
			// the initial timeout time
			let timeoutTime =  ${(this._updateInterval * 1e3).toFixed(1)};
			// onmessage callback
			self.onmessage = function(msg){
				timeoutTime = parseInt(msg.data);
			};
			// the tick function which posts a message
			// and schedules a new tick
			function tick(){
				setTimeout(tick, timeoutTime);
				self.postMessage('tick');
			}
			// call tick initially
			tick();
			`], { type: "text/javascript" }), r = URL.createObjectURL(e), n = new Worker(r);
      n.onmessage = this._callback.bind(this), this._worker = n;
    }
    _createTimeout() {
      this._timeout = setTimeout(() => {
        this._createTimeout(), this._callback();
      }, this._updateInterval * 1e3);
    }
    _createClock() {
      if (this._type === "worker") try {
        this._createWorker();
      } catch {
        this._type = "timeout", this._createClock();
      }
      else this._type === "timeout" && this._createTimeout();
    }
    _disposeClock() {
      this._timeout && clearTimeout(this._timeout), this._worker && (this._worker.terminate(), this._worker.onmessage = null);
    }
    get updateInterval() {
      return this._updateInterval;
    }
    set updateInterval(e) {
      var r;
      this._updateInterval = Math.max(e, this._minimumUpdateInterval), this._type === "worker" && ((r = this._worker) === null || r === void 0 || r.postMessage(this._updateInterval * 1e3));
    }
    get type() {
      return this._type;
    }
    set type(e) {
      this._disposeClock(), this._type = e, this._createClock();
    }
    dispose() {
      this._disposeClock();
    }
  };
  function xr(t) {
    return Jy(t);
  }
  function Ir(t) {
    return Ky(t);
  }
  function cs(t) {
    return ev(t);
  }
  function Fn(t) {
    return Zy(t);
  }
  function hv(t) {
    return t instanceof Zh;
  }
  function lT(t, e) {
    return t === "value" || xr(e) || Ir(e) || hv(e);
  }
  function yr(t, ...e) {
    if (!e.length) return t;
    let r = e.shift();
    if (_r(t) && _r(r)) for (let n in r) lT(n, r[n]) ? t[n] = r[n] : _r(r[n]) ? (t[n] || Object.assign(t, { [n]: {} }), yr(t[n], r[n])) : Object.assign(t, { [n]: r[n] });
    return yr(t, ...e);
  }
  function pv(t, e) {
    return t.length === e.length && t.every((r, n) => e[n] === r);
  }
  function O(t, e, r = [], n) {
    let o = {}, s = Array.from(e);
    if (_r(s[0]) && n && !Reflect.has(s[0], n) && (Object.keys(s[0]).some((a) => Reflect.has(t, a)) || (yr(o, { [n]: s[0] }), r.splice(r.indexOf(n), 1), s.shift())), s.length === 1 && _r(s[0])) yr(o, s[0]);
    else for (let i = 0; i < r.length; i++) X(s[i]) && (o[r[i]] = s[i]);
    return yr(t, o);
  }
  function fv(t) {
    return t.constructor.getDefaults();
  }
  function qt(t, e) {
    return Ie(t) ? e : t;
  }
  function Pr(t, e) {
    return e.forEach((r) => {
      Reflect.has(t, r) && delete t[r];
    }), t;
  }
  var $e = class {
    constructor() {
      this.debug = false, this._wasDisposed = false;
    }
    static getDefaults() {
      return {};
    }
    log(...e) {
      (this.debug || ht && this.toString() === ht.TONE_DEBUG_CLASS) && iv(this, ...e);
    }
    dispose() {
      return this._wasDisposed = true, this;
    }
    get disposed() {
      return this._wasDisposed;
    }
    toString() {
      return this.name;
    }
  };
  $e.version = xi;
  function Kr(t, e) {
    return t > e + 1e-6;
  }
  function Pi(t, e) {
    return Kr(t, e) || vt(t, e);
  }
  function oo(t, e) {
    return t + 1e-6 < e;
  }
  function vt(t, e) {
    return Math.abs(t - e) < 1e-6;
  }
  function op(t, e, r) {
    return Math.max(Math.min(t, r), e);
  }
  var je = class t extends $e {
    constructor() {
      super(), this.name = "Timeline", this._timeline = [];
      let e = O(t.getDefaults(), arguments, ["memory"]);
      this.memory = e.memory, this.increasing = e.increasing;
    }
    static getDefaults() {
      return { memory: 1 / 0, increasing: false };
    }
    get length() {
      return this._timeline.length;
    }
    add(e) {
      if (Q(Reflect.has(e, "time"), "Timeline: events must have a time attribute"), e.time = e.time.valueOf(), this.increasing && this.length) {
        let r = this._timeline[this.length - 1];
        Q(Pi(e.time, r.time), "The time must be greater than or equal to the last scheduled time"), this._timeline.push(e);
      } else {
        let r = this._search(e.time);
        this._timeline.splice(r + 1, 0, e);
      }
      if (this.length > this.memory) {
        let r = this.length - this.memory;
        this._timeline.splice(0, r);
      }
      return this;
    }
    remove(e) {
      let r = this._timeline.indexOf(e);
      return r !== -1 && this._timeline.splice(r, 1), this;
    }
    get(e, r = "time") {
      let n = this._search(e, r);
      return n !== -1 ? this._timeline[n] : null;
    }
    peek() {
      return this._timeline[0];
    }
    shift() {
      return this._timeline.shift();
    }
    getAfter(e, r = "time") {
      let n = this._search(e, r);
      return n + 1 < this._timeline.length ? this._timeline[n + 1] : null;
    }
    getBefore(e) {
      let r = this._timeline.length;
      if (r > 0 && this._timeline[r - 1].time < e) return this._timeline[r - 1];
      let n = this._search(e);
      return n - 1 >= 0 ? this._timeline[n - 1] : null;
    }
    cancel(e) {
      if (this._timeline.length > 1) {
        let r = this._search(e);
        if (r >= 0) if (vt(this._timeline[r].time, e)) {
          for (let n = r; n >= 0 && vt(this._timeline[n].time, e); n--) r = n;
          this._timeline = this._timeline.slice(0, r);
        } else this._timeline = this._timeline.slice(0, r + 1);
        else this._timeline = [];
      } else this._timeline.length === 1 && Pi(this._timeline[0].time, e) && (this._timeline = []);
      return this;
    }
    cancelBefore(e) {
      let r = this._search(e);
      return r >= 0 && (this._timeline = this._timeline.slice(r + 1)), this;
    }
    previousEvent(e) {
      let r = this._timeline.indexOf(e);
      return r > 0 ? this._timeline[r - 1] : null;
    }
    _search(e, r = "time") {
      if (this._timeline.length === 0) return -1;
      let n = 0, o = this._timeline.length, s = o;
      if (o > 0 && this._timeline[o - 1][r] <= e) return o - 1;
      for (; n < s; ) {
        let i = Math.floor(n + (s - n) / 2), a = this._timeline[i], l = this._timeline[i + 1];
        if (vt(a[r], e)) {
          for (let u = i; u < this._timeline.length; u++) {
            let c = this._timeline[u];
            if (vt(c[r], e)) i = u;
            else break;
          }
          return i;
        } else {
          if (oo(a[r], e) && Kr(l[r], e)) return i;
          Kr(a[r], e) ? s = i : n = i + 1;
        }
      }
      return -1;
    }
    _iterate(e, r = 0, n = this._timeline.length - 1) {
      this._timeline.slice(r, n + 1).forEach(e);
    }
    forEach(e) {
      return this._iterate(e), this;
    }
    forEachBefore(e, r) {
      let n = this._search(e);
      return n !== -1 && this._iterate(r, 0, n), this;
    }
    forEachAfter(e, r) {
      let n = this._search(e);
      return this._iterate(r, n + 1), this;
    }
    forEachBetween(e, r, n) {
      let o = this._search(e), s = this._search(r);
      return o !== -1 && s !== -1 ? (this._timeline[o].time !== e && (o += 1), this._timeline[s].time === r && (s -= 1), this._iterate(n, o, s)) : o === -1 && this._iterate(n, 0, s), this;
    }
    forEachFrom(e, r) {
      let n = this._search(e);
      for (; n >= 0 && this._timeline[n].time >= e; ) n--;
      return this._iterate(r, n + 1), this;
    }
    forEachAtTime(e, r) {
      let n = this._search(e);
      if (n !== -1 && vt(this._timeline[n].time, e)) {
        let o = n;
        for (let s = n; s >= 0 && vt(this._timeline[s].time, e); s--) o = s;
        this._iterate((s) => {
          r(s);
        }, o, n);
      }
      return this;
    }
    dispose() {
      return super.dispose(), this._timeline = [], this;
    }
  };
  var dv = [];
  function In(t) {
    dv.push(t);
  }
  function mv(t) {
    dv.forEach((e) => e(t));
  }
  var gv = [];
  function Pn(t) {
    gv.push(t);
  }
  function _v(t) {
    gv.forEach((e) => e(t));
  }
  var Vn = class t extends $e {
    constructor() {
      super(...arguments), this.name = "Emitter";
    }
    on(e, r) {
      return e.split(/\W+/).forEach((o) => {
        Ie(this._events) && (this._events = {}), this._events.hasOwnProperty(o) || (this._events[o] = []), this._events[o].push(r);
      }), this;
    }
    once(e, r) {
      let n = (...o) => {
        r(...o), this.off(e, n);
      };
      return this.on(e, n), this;
    }
    off(e, r) {
      return e.split(/\W+/).forEach((o) => {
        if (Ie(this._events) && (this._events = {}), this._events.hasOwnProperty(o)) if (Ie(r)) this._events[o] = [];
        else {
          let s = this._events[o];
          for (let i = s.length - 1; i >= 0; i--) s[i] === r && s.splice(i, 1);
        }
      }), this;
    }
    emit(e, ...r) {
      if (this._events && this._events.hasOwnProperty(e)) {
        let n = this._events[e].slice(0);
        for (let o = 0, s = n.length; o < s; o++) n[o].apply(this, r);
      }
      return this;
    }
    static mixin(e) {
      ["on", "once", "off", "emit"].forEach((r) => {
        let n = Object.getOwnPropertyDescriptor(t.prototype, r);
        Object.defineProperty(e.prototype, r, n);
      });
    }
    dispose() {
      return super.dispose(), this._events = void 0, this;
    }
  };
  var hs = class extends Vn {
    constructor() {
      super(...arguments), this.isOffline = false;
    }
    toJSON() {
      return {};
    }
  };
  var so = class t extends hs {
    constructor() {
      var e, r;
      super(), this.name = "Context", this._constants = /* @__PURE__ */ new Map(), this._timeouts = new je(), this._timeoutIds = 0, this._initialized = false, this._closeStarted = false, this.isOffline = false, this._workletPromise = null;
      let n = O(t.getDefaults(), arguments, ["context"]);
      n.context ? (this._context = n.context, this._latencyHint = ((e = arguments[0]) === null || e === void 0 ? void 0 : e.latencyHint) || "") : (this._context = av({ latencyHint: n.latencyHint }), this._latencyHint = n.latencyHint), this._ticker = new Rl(this.emit.bind(this, "tick"), n.clockSource, n.updateInterval, this._context.sampleRate), this.on("tick", this._timeoutLoop.bind(this)), this._context.onstatechange = () => {
        this.emit("statechange", this.state);
      }, this[!((r = arguments[0]) === null || r === void 0) && r.hasOwnProperty("updateInterval") ? "_lookAhead" : "lookAhead"] = n.lookAhead;
    }
    static getDefaults() {
      return { clockSource: "worker", latencyHint: "interactive", lookAhead: 0.1, updateInterval: 0.05 };
    }
    initialize() {
      return this._initialized || (mv(this), this._initialized = true), this;
    }
    createAnalyser() {
      return this._context.createAnalyser();
    }
    createOscillator() {
      return this._context.createOscillator();
    }
    createBufferSource() {
      return this._context.createBufferSource();
    }
    createBiquadFilter() {
      return this._context.createBiquadFilter();
    }
    createBuffer(e, r, n) {
      return this._context.createBuffer(e, r, n);
    }
    createChannelMerger(e) {
      return this._context.createChannelMerger(e);
    }
    createChannelSplitter(e) {
      return this._context.createChannelSplitter(e);
    }
    createConstantSource() {
      return this._context.createConstantSource();
    }
    createConvolver() {
      return this._context.createConvolver();
    }
    createDelay(e) {
      return this._context.createDelay(e);
    }
    createDynamicsCompressor() {
      return this._context.createDynamicsCompressor();
    }
    createGain() {
      return this._context.createGain();
    }
    createIIRFilter(e, r) {
      return this._context.createIIRFilter(e, r);
    }
    createPanner() {
      return this._context.createPanner();
    }
    createPeriodicWave(e, r, n) {
      return this._context.createPeriodicWave(e, r, n);
    }
    createStereoPanner() {
      return this._context.createStereoPanner();
    }
    createWaveShaper() {
      return this._context.createWaveShaper();
    }
    createMediaStreamSource(e) {
      return Q(Fn(this._context), "Not available if OfflineAudioContext"), this._context.createMediaStreamSource(e);
    }
    createMediaElementSource(e) {
      return Q(Fn(this._context), "Not available if OfflineAudioContext"), this._context.createMediaElementSource(e);
    }
    createMediaStreamDestination() {
      return Q(Fn(this._context), "Not available if OfflineAudioContext"), this._context.createMediaStreamDestination();
    }
    decodeAudioData(e) {
      return this._context.decodeAudioData(e);
    }
    get currentTime() {
      return this._context.currentTime;
    }
    get state() {
      return this._context.state;
    }
    get sampleRate() {
      return this._context.sampleRate;
    }
    get listener() {
      return this.initialize(), this._listener;
    }
    set listener(e) {
      Q(!this._initialized, "The listener cannot be set after initialization."), this._listener = e;
    }
    get transport() {
      return this.initialize(), this._transport;
    }
    set transport(e) {
      Q(!this._initialized, "The transport cannot be set after initialization."), this._transport = e;
    }
    get draw() {
      return this.initialize(), this._draw;
    }
    set draw(e) {
      Q(!this._initialized, "Draw cannot be set after initialization."), this._draw = e;
    }
    get destination() {
      return this.initialize(), this._destination;
    }
    set destination(e) {
      Q(!this._initialized, "The destination cannot be set after initialization."), this._destination = e;
    }
    createAudioWorkletNode(e, r) {
      return cv(this.rawContext, e, r);
    }
    addAudioWorkletModule(e) {
      return oe(this, void 0, void 0, function* () {
        Q(X(this.rawContext.audioWorklet), "AudioWorkletNode is only available in a secure context (https or localhost)"), this._workletPromise || (this._workletPromise = this.rawContext.audioWorklet.addModule(e)), yield this._workletPromise;
      });
    }
    workletsAreReady() {
      return oe(this, void 0, void 0, function* () {
        (yield this._workletPromise) ? this._workletPromise : Promise.resolve();
      });
    }
    get updateInterval() {
      return this._ticker.updateInterval;
    }
    set updateInterval(e) {
      this._ticker.updateInterval = e;
    }
    get clockSource() {
      return this._ticker.type;
    }
    set clockSource(e) {
      this._ticker.type = e;
    }
    get lookAhead() {
      return this._lookAhead;
    }
    set lookAhead(e) {
      this._lookAhead = e, this.updateInterval = e ? e / 2 : 0.01;
    }
    get latencyHint() {
      return this._latencyHint;
    }
    get rawContext() {
      return this._context;
    }
    now() {
      return this._context.currentTime + this._lookAhead;
    }
    immediate() {
      return this._context.currentTime;
    }
    resume() {
      return Fn(this._context) ? this._context.resume() : Promise.resolve();
    }
    close() {
      return oe(this, void 0, void 0, function* () {
        Fn(this._context) && this.state !== "closed" && !this._closeStarted && (this._closeStarted = true, yield this._context.close()), this._initialized && _v(this);
      });
    }
    getConstant(e) {
      if (this._constants.has(e)) return this._constants.get(e);
      {
        let r = this._context.createBuffer(1, 128, this._context.sampleRate), n = r.getChannelData(0);
        for (let s = 0; s < n.length; s++) n[s] = e;
        let o = this._context.createBufferSource();
        return o.channelCount = 1, o.channelCountMode = "explicit", o.buffer = r, o.loop = true, o.start(0), this._constants.set(e, o), o;
      }
    }
    dispose() {
      return super.dispose(), this._ticker.dispose(), this._timeouts.dispose(), Object.keys(this._constants).map((e) => this._constants[e].disconnect()), this.close(), this;
    }
    _timeoutLoop() {
      let e = this.now();
      this._timeouts.forEachBefore(e, (r) => {
        r.callback(), this._timeouts.remove(r);
      });
    }
    setTimeout(e, r) {
      this._timeoutIds++;
      let n = this.now();
      return this._timeouts.add({ callback: e, id: this._timeoutIds, time: n + r }), this._timeoutIds;
    }
    clearTimeout(e) {
      return this._timeouts.forEach((r) => {
        r.id === e && this._timeouts.remove(r);
      }), this;
    }
    clearInterval(e) {
      return this.clearTimeout(e);
    }
    setInterval(e, r) {
      let n = ++this._timeoutIds, o = () => {
        let s = this.now();
        this._timeouts.add({ callback: () => {
          e(), o();
        }, id: n, time: s + r });
      };
      return o(), n;
    }
  };
  var Fl = class extends hs {
    constructor() {
      super(...arguments), this.lookAhead = 0, this.latencyHint = 0, this.isOffline = false;
    }
    createAnalyser() {
      return {};
    }
    createOscillator() {
      return {};
    }
    createBufferSource() {
      return {};
    }
    createBiquadFilter() {
      return {};
    }
    createBuffer(e, r, n) {
      return {};
    }
    createChannelMerger(e) {
      return {};
    }
    createChannelSplitter(e) {
      return {};
    }
    createConstantSource() {
      return {};
    }
    createConvolver() {
      return {};
    }
    createDelay(e) {
      return {};
    }
    createDynamicsCompressor() {
      return {};
    }
    createGain() {
      return {};
    }
    createIIRFilter(e, r) {
      return {};
    }
    createPanner() {
      return {};
    }
    createPeriodicWave(e, r, n) {
      return {};
    }
    createStereoPanner() {
      return {};
    }
    createWaveShaper() {
      return {};
    }
    createMediaStreamSource(e) {
      return {};
    }
    createMediaElementSource(e) {
      return {};
    }
    createMediaStreamDestination() {
      return {};
    }
    decodeAudioData(e) {
      return Promise.resolve({});
    }
    createAudioWorkletNode(e, r) {
      return {};
    }
    get rawContext() {
      return {};
    }
    addAudioWorkletModule(e) {
      return oe(this, void 0, void 0, function* () {
        return Promise.resolve();
      });
    }
    resume() {
      return Promise.resolve();
    }
    setTimeout(e, r) {
      return 0;
    }
    clearTimeout(e) {
      return this;
    }
    setInterval(e, r) {
      return 0;
    }
    clearInterval(e) {
      return this;
    }
    getConstant(e) {
      return {};
    }
    get currentTime() {
      return 0;
    }
    get state() {
      return {};
    }
    get sampleRate() {
      return 0;
    }
    get listener() {
      return {};
    }
    get transport() {
      return {};
    }
    get draw() {
      return {};
    }
    set draw(e) {
    }
    get destination() {
      return {};
    }
    set destination(e) {
    }
    now() {
      return 0;
    }
    immediate() {
      return 0;
    }
  };
  function z(t, e) {
    Pe(e) ? e.forEach((r) => z(t, r)) : Object.defineProperty(t, e, { enumerable: true, writable: false });
  }
  function ps(t, e) {
    Pe(e) ? e.forEach((r) => ps(t, r)) : Object.defineProperty(t, e, { writable: true });
  }
  var Z = () => {
  };
  var Ye = class t extends $e {
    constructor() {
      super(), this.name = "ToneAudioBuffer", this.onload = Z;
      let e = O(t.getDefaults(), arguments, ["url", "onload", "onerror"]);
      this.reverse = e.reverse, this.onload = e.onload, ct(e.url) ? this.load(e.url).catch(e.onerror) : e.url && this.set(e.url);
    }
    static getDefaults() {
      return { onerror: Z, onload: Z, reverse: false };
    }
    get sampleRate() {
      return this._buffer ? this._buffer.sampleRate : Ve().sampleRate;
    }
    set(e) {
      return e instanceof t ? e.loaded ? this._buffer = e.get() : e.onload = () => {
        this.set(e), this.onload(this);
      } : this._buffer = e, this._reversed && this._reverse(), this;
    }
    get() {
      return this._buffer;
    }
    load(e) {
      return oe(this, void 0, void 0, function* () {
        let r = t.load(e).then((n) => {
          this.set(n), this.onload(this);
        });
        t.downloads.push(r);
        try {
          yield r;
        } finally {
          let n = t.downloads.indexOf(r);
          t.downloads.splice(n, 1);
        }
        return this;
      });
    }
    dispose() {
      return super.dispose(), this._buffer = void 0, this;
    }
    fromArray(e) {
      let r = Pe(e) && e[0].length > 0, n = r ? e.length : 1, o = r ? e[0].length : e.length, s = Ve(), i = s.createBuffer(n, o, s.sampleRate), a = !r && n === 1 ? [e] : e;
      for (let l = 0; l < n; l++) i.copyToChannel(a[l], l);
      return this._buffer = i, this;
    }
    toMono(e) {
      if (yt(e)) this.fromArray(this.toArray(e));
      else {
        let r = new Float32Array(this.length), n = this.numberOfChannels;
        for (let o = 0; o < n; o++) {
          let s = this.toArray(o);
          for (let i = 0; i < s.length; i++) r[i] += s[i];
        }
        r = r.map((o) => o / n), this.fromArray(r);
      }
      return this;
    }
    toArray(e) {
      if (yt(e)) return this.getChannelData(e);
      if (this.numberOfChannels === 1) return this.toArray(0);
      {
        let r = [];
        for (let n = 0; n < this.numberOfChannels; n++) r[n] = this.getChannelData(n);
        return r;
      }
    }
    getChannelData(e) {
      return this._buffer ? this._buffer.getChannelData(e) : new Float32Array(0);
    }
    slice(e, r = this.duration) {
      Q(this.loaded, "Buffer is not loaded");
      let n = Math.floor(e * this.sampleRate), o = Math.floor(r * this.sampleRate);
      Q(n < o, "The start time must be less than the end time");
      let s = o - n, i = Ve().createBuffer(this.numberOfChannels, s, this.sampleRate);
      for (let a = 0; a < this.numberOfChannels; a++) i.copyToChannel(this.getChannelData(a).subarray(n, o), a);
      return new t(i);
    }
    _reverse() {
      if (this.loaded) for (let e = 0; e < this.numberOfChannels; e++) this.getChannelData(e).reverse();
      return this;
    }
    get loaded() {
      return this.length > 0;
    }
    get duration() {
      return this._buffer ? this._buffer.duration : 0;
    }
    get length() {
      return this._buffer ? this._buffer.length : 0;
    }
    get numberOfChannels() {
      return this._buffer ? this._buffer.numberOfChannels : 0;
    }
    get reverse() {
      return this._reversed;
    }
    set reverse(e) {
      this._reversed !== e && (this._reversed = e, this._reverse());
    }
    static fromArray(e) {
      return new t().fromArray(e);
    }
    static fromUrl(e) {
      return oe(this, void 0, void 0, function* () {
        return yield new t().load(e);
      });
    }
    static load(e) {
      return oe(this, void 0, void 0, function* () {
        let r = t.baseUrl === "" || t.baseUrl.endsWith("/") ? t.baseUrl : t.baseUrl + "/", n = yield fetch(r + e);
        if (!n.ok) throw new Error(`could not load url: ${e}`);
        let o = yield n.arrayBuffer();
        return yield Ve().decodeAudioData(o);
      });
    }
    static supportsType(e) {
      let r = e.split("."), n = r[r.length - 1];
      return document.createElement("audio").canPlayType("audio/" + n) !== "";
    }
    static loaded() {
      return oe(this, void 0, void 0, function* () {
        for (yield Promise.resolve(); t.downloads.length; ) yield t.downloads[0];
      });
    }
  };
  Ye.baseUrl = "";
  Ye.downloads = [];
  var Vr = class extends so {
    constructor() {
      super({ clockSource: "offline", context: cs(arguments[0]) ? arguments[0] : lv(arguments[0], arguments[1] * arguments[2], arguments[2]), lookAhead: 0, updateInterval: cs(arguments[0]) ? 128 / arguments[0].sampleRate : 128 / arguments[2] }), this.name = "OfflineContext", this._currentTime = 0, this.isOffline = true, this._duration = cs(arguments[0]) ? arguments[0].length / arguments[0].sampleRate : arguments[1];
    }
    now() {
      return this._currentTime;
    }
    get currentTime() {
      return this._currentTime;
    }
    _renderClock(e) {
      return oe(this, void 0, void 0, function* () {
        let r = 0;
        for (; this._duration - this._currentTime >= 0; ) {
          this.emit("tick"), this._currentTime += 128 / this.sampleRate, r++;
          let n = Math.floor(this.sampleRate / 128);
          e && r % n === 0 && (yield new Promise((o) => setTimeout(o, 1)));
        }
      });
    }
    render() {
      return oe(this, arguments, void 0, function* (e = true) {
        yield this.workletsAreReady(), yield this._renderClock(e);
        let r = yield this._context.startRendering();
        return new Ye(r);
      });
    }
    close() {
      return Promise.resolve();
    }
  };
  var xv = new Fl(), io = xv;
  function Ve() {
    return io === xv && uv && sp(new so()), io;
  }
  function sp(t, e = false) {
    e && io.dispose(), Fn(t) ? io = new so(t) : cs(t) ? io = new Vr(t) : io = t;
  }
  function ip() {
    return io.resume();
  }
  if (ht && !ht.TONE_SILENCE_LOGGING) {
    let t = "v";
    xi === "dev" && (t = "");
    let e = ` * Tone.js ${t}${xi} * `;
    console.log(`%c${e}`, "background: #000; color: #fff");
  }
  function fs(t) {
    return Math.pow(10, t / 20);
  }
  function ds(t) {
    return 20 * (Math.log(t) / Math.LN10);
  }
  function ao(t) {
    return Math.pow(2, t / 12);
  }
  var Il = 440;
  function yv() {
    return Il;
  }
  function vv(t) {
    Il = t;
  }
  function lo(t) {
    return Math.round(ap(t));
  }
  function ap(t) {
    return 69 + 12 * Math.log2(t / Il);
  }
  function Pl(t) {
    return Il * Math.pow(2, (t - 69) / 12);
  }
  var Vl = class t extends $e {
    constructor(e, r, n) {
      super(), this.defaultUnits = "s", this._val = r, this._units = n, this.context = e, this._expressions = this._getExpressions();
    }
    _getExpressions() {
      return { hz: { method: (e) => this._frequencyToUnits(parseFloat(e)), regexp: /^(\d+(?:\.\d+)?)hz$/i }, i: { method: (e) => this._ticksToUnits(parseInt(e, 10)), regexp: /^(\d+)i$/i }, m: { method: (e) => this._beatsToUnits(parseInt(e, 10) * this._getTimeSignature()), regexp: /^(\d+)m$/i }, n: { method: (e, r) => {
        let n = parseInt(e, 10), o = r === "." ? 1.5 : 1;
        return n === 1 ? this._beatsToUnits(this._getTimeSignature()) * o : this._beatsToUnits(4 / n) * o;
      }, regexp: /^(\d+)n(\.?)$/i }, number: { method: (e) => this._expressions[this.defaultUnits].method.call(this, e), regexp: /^(\d+(?:\.\d+)?)$/ }, s: { method: (e) => this._secondsToUnits(parseFloat(e)), regexp: /^(\d+(?:\.\d+)?)s$/ }, samples: { method: (e) => parseInt(e, 10) / this.context.sampleRate, regexp: /^(\d+)samples$/ }, t: { method: (e) => {
        let r = parseInt(e, 10);
        return this._beatsToUnits(8 / (Math.floor(r) * 3));
      }, regexp: /^(\d+)t$/i }, tr: { method: (e, r, n) => {
        let o = 0;
        return e && e !== "0" && (o += this._beatsToUnits(this._getTimeSignature() * parseFloat(e))), r && r !== "0" && (o += this._beatsToUnits(parseFloat(r))), n && n !== "0" && (o += this._beatsToUnits(parseFloat(n) / 4)), o;
      }, regexp: /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?):?(\d+(?:\.\d+)?)?$/ } };
    }
    valueOf() {
      if (this._val instanceof t && this.fromType(this._val), Ie(this._val)) return this._noArg();
      if (ct(this._val) && Ie(this._units)) {
        for (let e in this._expressions) if (this._expressions[e].regexp.test(this._val.trim())) {
          this._units = e;
          break;
        }
      } else if (_r(this._val)) {
        let e = 0;
        for (let r in this._val) if (X(this._val[r])) {
          let n = this._val[r], o = new this.constructor(this.context, r).valueOf() * n;
          e += o;
        }
        return e;
      }
      if (X(this._units)) {
        let e = this._expressions[this._units], r = this._val.toString().trim().match(e.regexp);
        return r ? e.method.apply(this, r.slice(1)) : e.method.call(this, this._val);
      } else return ct(this._val) ? parseFloat(this._val) : this._val;
    }
    _frequencyToUnits(e) {
      return 1 / e;
    }
    _beatsToUnits(e) {
      return 60 / this._getBpm() * e;
    }
    _secondsToUnits(e) {
      return e;
    }
    _ticksToUnits(e) {
      return e * this._beatsToUnits(1) / this._getPPQ();
    }
    _noArg() {
      return this._now();
    }
    _getBpm() {
      return this.context.transport.bpm.value;
    }
    _getTimeSignature() {
      return this.context.transport.timeSignature;
    }
    _getPPQ() {
      return this.context.transport.PPQ;
    }
    fromType(e) {
      switch (this._units = void 0, this.defaultUnits) {
        case "s":
          this._val = e.toSeconds();
          break;
        case "i":
          this._val = e.toTicks();
          break;
        case "hz":
          this._val = e.toFrequency();
          break;
        case "midi":
          this._val = e.toMidi();
          break;
      }
      return this;
    }
    toFrequency() {
      return 1 / this.toSeconds();
    }
    toSamples() {
      return this.toSeconds() * this.context.sampleRate;
    }
    toMilliseconds() {
      return this.toSeconds() * 1e3;
    }
  };
  var jt = class t extends Vl {
    constructor() {
      super(...arguments), this.name = "TimeClass";
    }
    _getExpressions() {
      return Object.assign(super._getExpressions(), { now: { method: (e) => this._now() + new this.constructor(this.context, e).valueOf(), regexp: /^\+(.+)/ }, quantize: { method: (e) => {
        let r = new t(this.context, e).valueOf();
        return this._secondsToUnits(this.context.transport.nextSubdivision(r));
      }, regexp: /^@(.+)/ } });
    }
    quantize(e, r = 1) {
      let n = new this.constructor(this.context, e).valueOf(), o = this.valueOf(), a = Math.round(o / n) * n - o;
      return o + a * r;
    }
    toNotation() {
      let e = this.toSeconds(), r = ["1m"];
      for (let s = 1; s < 9; s++) {
        let i = Math.pow(2, s);
        r.push(i + "n."), r.push(i + "n"), r.push(i + "t");
      }
      r.push("0");
      let n = r[0], o = new t(this.context, r[0]).toSeconds();
      return r.forEach((s) => {
        let i = new t(this.context, s).toSeconds();
        Math.abs(i - e) < Math.abs(o - e) && (n = s, o = i);
      }), n;
    }
    toBarsBeatsSixteenths() {
      let e = this._beatsToUnits(1), r = this.valueOf() / e;
      r = parseFloat(r.toFixed(4));
      let n = Math.floor(r / this._getTimeSignature()), o = r % 1 * 4;
      r = Math.floor(r) % this._getTimeSignature();
      let s = o.toString();
      return s.length > 3 && (o = parseFloat(parseFloat(s).toFixed(3))), [n, r, o].join(":");
    }
    toTicks() {
      let e = this._beatsToUnits(1);
      return this.valueOf() / e * this._getPPQ();
    }
    toSeconds() {
      return this.valueOf();
    }
    toMidi() {
      return lo(this.toFrequency());
    }
    _now() {
      return this.context.now();
    }
  };
  var bt = class t extends jt {
    constructor() {
      super(...arguments), this.name = "Frequency", this.defaultUnits = "hz";
    }
    static get A4() {
      return yv();
    }
    static set A4(e) {
      vv(e);
    }
    _getExpressions() {
      return Object.assign({}, super._getExpressions(), { midi: { regexp: /^(\d+(?:\.\d+)?midi)/, method(e) {
        return this.defaultUnits === "midi" ? e : t.mtof(e);
      } }, note: { regexp: /^([a-g]{1}(?:b|#|##|x|bb|###|#x|x#|bbb)?)(-?[0-9]+)/i, method(e, r) {
        let o = uT[e.toLowerCase()] + (parseInt(r, 10) + 1) * 12;
        return this.defaultUnits === "midi" ? o : t.mtof(o);
      } }, tr: { regexp: /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?):?(\d+(?:\.\d+)?)?/, method(e, r, n) {
        let o = 1;
        return e && e !== "0" && (o *= this._beatsToUnits(this._getTimeSignature() * parseFloat(e))), r && r !== "0" && (o *= this._beatsToUnits(parseFloat(r))), n && n !== "0" && (o *= this._beatsToUnits(parseFloat(n) / 4)), o;
      } } });
    }
    transpose(e) {
      return new t(this.context, this.valueOf() * ao(e));
    }
    harmonize(e) {
      return e.map((r) => this.transpose(r));
    }
    toMidi() {
      return lo(this.valueOf());
    }
    toNote() {
      let e = this.toFrequency(), r = Math.log2(e / t.A4), n = Math.round(12 * r) + 57, o = Math.floor(n / 12);
      return o < 0 && (n += -12 * o), cT[n % 12] + o.toString();
    }
    toSeconds() {
      return 1 / super.toSeconds();
    }
    toTicks() {
      let e = this._beatsToUnits(1), r = this.valueOf() / e;
      return Math.floor(r * this._getPPQ());
    }
    _noArg() {
      return 0;
    }
    _frequencyToUnits(e) {
      return e;
    }
    _ticksToUnits(e) {
      return 1 / (e * 60 / (this._getBpm() * this._getPPQ()));
    }
    _beatsToUnits(e) {
      return 1 / super._beatsToUnits(e);
    }
    _secondsToUnits(e) {
      return 1 / e;
    }
    static mtof(e) {
      return Pl(e);
    }
    static ftom(e) {
      return lo(e);
    }
  }, uT = { cbbb: -3, cbb: -2, cb: -1, c: 0, "c#": 1, cx: 2, "c##": 2, "c###": 3, "cx#": 3, "c#x": 3, dbbb: -1, dbb: 0, db: 1, d: 2, "d#": 3, dx: 4, "d##": 4, "d###": 5, "dx#": 5, "d#x": 5, ebbb: 1, ebb: 2, eb: 3, e: 4, "e#": 5, ex: 6, "e##": 6, "e###": 7, "ex#": 7, "e#x": 7, fbbb: 2, fbb: 3, fb: 4, f: 5, "f#": 6, fx: 7, "f##": 7, "f###": 8, "fx#": 8, "f#x": 8, gbbb: 4, gbb: 5, gb: 6, g: 7, "g#": 8, gx: 9, "g##": 9, "g###": 10, "gx#": 10, "g#x": 10, abbb: 6, abb: 7, ab: 8, a: 9, "a#": 10, ax: 11, "a##": 11, "a###": 12, "ax#": 12, "a#x": 12, bbbb: 8, bbb: 9, bb: 10, b: 11, "b#": 12, bx: 13, "b##": 13, "b###": 14, "bx#": 14, "b#x": 14 }, cT = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var nr = class extends jt {
    constructor() {
      super(...arguments), this.name = "TransportTime";
    }
    _now() {
      return this.context.transport.seconds;
    }
  };
  var ze = class t extends $e {
    constructor() {
      super();
      let e = O(t.getDefaults(), arguments, ["context"]);
      this.defaultContext ? this.context = this.defaultContext : this.context = e.context;
    }
    static getDefaults() {
      return { context: Ve() };
    }
    now() {
      return this.context.currentTime + this.context.lookAhead;
    }
    immediate() {
      return this.context.currentTime;
    }
    get sampleTime() {
      return 1 / this.context.sampleRate;
    }
    get blockTime() {
      return 128 / this.context.sampleRate;
    }
    toSeconds(e) {
      return ov(e), new jt(this.context, e).toSeconds();
    }
    toFrequency(e) {
      return new bt(this.context, e).toFrequency();
    }
    toTicks(e) {
      return new nr(this.context, e).toTicks();
    }
    _getPartialProperties(e) {
      let r = this.get();
      return Object.keys(r).forEach((n) => {
        Ie(e[n]) && delete r[n];
      }), r;
    }
    get() {
      let e = fv(this);
      return Object.keys(e).forEach((r) => {
        if (Reflect.has(this, r)) {
          let n = this[r];
          X(n) && X(n.value) && X(n.setValueAtTime) ? e[r] = n.value : n instanceof t ? e[r] = n._getPartialProperties(e[r]) : Pe(n) || yt(n) || ct(n) || rp(n) ? e[r] = n : delete e[r];
        }
      }), e;
    }
    set(e) {
      return Object.keys(e).forEach((r) => {
        Reflect.has(this, r) && X(this[r]) && (this[r] && X(this[r].value) && X(this[r].setValueAtTime) ? this[r].value !== e[r] && (this[r].value = e[r]) : this[r] instanceof t ? this[r].set(e[r]) : this[r] = e[r]);
      }), this;
    }
  };
  var Lr = class extends je {
    constructor(e = "stopped") {
      super(), this.name = "StateTimeline", this._initial = e, this.setStateAtTime(this._initial, 0);
    }
    getValueAtTime(e) {
      let r = this.get(e);
      return r !== null ? r.state : this._initial;
    }
    setStateAtTime(e, r, n) {
      return Ke(r, 0), this.add(Object.assign({}, n, { state: e, time: r })), this;
    }
    getLastState(e, r) {
      let n = this._search(r);
      for (let o = n; o >= 0; o--) {
        let s = this._timeline[o];
        if (s.state === e) return s;
      }
    }
    getNextState(e, r) {
      let n = this._search(r);
      if (n !== -1) for (let o = n; o < this._timeline.length; o++) {
        let s = this._timeline[o];
        if (s.state === e) return s;
      }
    }
  };
  var te = class t extends ze {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["param", "units", "convert"]);
      for (super(e), this.name = "Param", this.overridden = false, this._minOutput = 1e-7, Q(X(e.param) && (xr(e.param) || e.param instanceof t), "param must be an AudioParam"); !xr(e.param); ) e.param = e.param._param;
      this._swappable = X(e.swappable) ? e.swappable : false, this._swappable ? (this.input = this.context.createGain(), this._param = e.param, this.input.connect(this._param)) : this._param = this.input = e.param, this._events = new je(1e3), this._initialValue = this._param.defaultValue, this.units = e.units, this.convert = e.convert, this._minValue = e.minValue, this._maxValue = e.maxValue, X(e.value) && e.value !== this._toType(this._initialValue) && this.setValueAtTime(e.value, 0);
    }
    static getDefaults() {
      return Object.assign(ze.getDefaults(), { convert: true, units: "number" });
    }
    get value() {
      let e = this.now();
      return this.getValueAtTime(e);
    }
    set value(e) {
      this.cancelScheduledValues(this.now()), this.setValueAtTime(e, this.now());
    }
    get minValue() {
      return X(this._minValue) ? this._minValue : this.units === "time" || this.units === "frequency" || this.units === "normalRange" || this.units === "positive" || this.units === "transportTime" || this.units === "ticks" || this.units === "bpm" || this.units === "hertz" || this.units === "samples" ? 0 : this.units === "audioRange" ? -1 : this.units === "decibels" ? -1 / 0 : this._param.minValue;
    }
    get maxValue() {
      return X(this._maxValue) ? this._maxValue : this.units === "normalRange" || this.units === "audioRange" ? 1 : this._param.maxValue;
    }
    _is(e, r) {
      return this.units === r;
    }
    _assertRange(e) {
      return X(this.maxValue) && X(this.minValue) && Ke(e, this._fromType(this.minValue), this._fromType(this.maxValue)), e;
    }
    _fromType(e) {
      return this.convert && !this.overridden ? this._is(e, "time") ? this.toSeconds(e) : this._is(e, "decibels") ? fs(e) : this._is(e, "frequency") ? this.toFrequency(e) : e : this.overridden ? 0 : e;
    }
    _toType(e) {
      return this.convert && this.units === "decibels" ? ds(e) : e;
    }
    setValueAtTime(e, r) {
      let n = this.toSeconds(r), o = this._fromType(e);
      return Q(isFinite(o) && isFinite(n), `Invalid argument(s) to setValueAtTime: ${JSON.stringify(e)}, ${JSON.stringify(r)}`), this._assertRange(o), this.log(this.units, "setValueAtTime", e, n), this._events.add({ time: n, type: "setValueAtTime", value: o }), this._param.setValueAtTime(o, n), this;
    }
    getValueAtTime(e) {
      let r = Math.max(this.toSeconds(e), 0), n = this._events.getAfter(r), o = this._events.get(r), s = this._initialValue;
      if (o === null) s = this._initialValue;
      else if (o.type === "setTargetAtTime" && (n === null || n.type === "setValueAtTime")) {
        let i = this._events.getBefore(o.time), a;
        i === null ? a = this._initialValue : a = i.value, o.type === "setTargetAtTime" && (s = this._exponentialApproach(o.time, a, o.value, o.constant, r));
      } else if (n === null) s = o.value;
      else if (n.type === "linearRampToValueAtTime" || n.type === "exponentialRampToValueAtTime") {
        let i = o.value;
        if (o.type === "setTargetAtTime") {
          let a = this._events.getBefore(o.time);
          a === null ? i = this._initialValue : i = a.value;
        }
        n.type === "linearRampToValueAtTime" ? s = this._linearInterpolate(o.time, i, n.time, n.value, r) : s = this._exponentialInterpolate(o.time, i, n.time, n.value, r);
      } else s = o.value;
      return this._toType(s);
    }
    setRampPoint(e) {
      e = this.toSeconds(e);
      let r = this.getValueAtTime(e);
      return this.cancelAndHoldAtTime(e), this._fromType(r) === 0 && (r = this._toType(this._minOutput)), this.setValueAtTime(r, e), this;
    }
    linearRampToValueAtTime(e, r) {
      let n = this._fromType(e), o = this.toSeconds(r);
      return Q(isFinite(n) && isFinite(o), `Invalid argument(s) to linearRampToValueAtTime: ${JSON.stringify(e)}, ${JSON.stringify(r)}`), this._assertRange(n), this._events.add({ time: o, type: "linearRampToValueAtTime", value: n }), this.log(this.units, "linearRampToValueAtTime", e, o), this._param.linearRampToValueAtTime(n, o), this;
    }
    exponentialRampToValueAtTime(e, r) {
      let n = this._fromType(e);
      n = vt(n, 0) ? this._minOutput : n, this._assertRange(n);
      let o = this.toSeconds(r);
      return Q(isFinite(n) && isFinite(o), `Invalid argument(s) to exponentialRampToValueAtTime: ${JSON.stringify(e)}, ${JSON.stringify(r)}`), this._events.add({ time: o, type: "exponentialRampToValueAtTime", value: n }), this.log(this.units, "exponentialRampToValueAtTime", e, o), this._param.exponentialRampToValueAtTime(n, o), this;
    }
    exponentialRampTo(e, r, n) {
      return n = this.toSeconds(n), this.setRampPoint(n), this.exponentialRampToValueAtTime(e, n + this.toSeconds(r)), this;
    }
    linearRampTo(e, r, n) {
      return n = this.toSeconds(n), this.setRampPoint(n), this.linearRampToValueAtTime(e, n + this.toSeconds(r)), this;
    }
    targetRampTo(e, r, n) {
      return n = this.toSeconds(n), this.setRampPoint(n), this.exponentialApproachValueAtTime(e, n, r), this;
    }
    exponentialApproachValueAtTime(e, r, n) {
      r = this.toSeconds(r), n = this.toSeconds(n);
      let o = Math.log(n + 1) / Math.log(200);
      return this.setTargetAtTime(e, r, o), this.cancelAndHoldAtTime(r + n * 0.9), this.linearRampToValueAtTime(e, r + n), this;
    }
    setTargetAtTime(e, r, n) {
      let o = this._fromType(e);
      Q(isFinite(n) && n > 0, "timeConstant must be a number greater than 0");
      let s = this.toSeconds(r);
      return this._assertRange(o), Q(isFinite(o) && isFinite(s), `Invalid argument(s) to setTargetAtTime: ${JSON.stringify(e)}, ${JSON.stringify(r)}`), this._events.add({ constant: n, time: s, type: "setTargetAtTime", value: o }), this.log(this.units, "setTargetAtTime", e, s, n), this._param.setTargetAtTime(o, s, n), this;
    }
    setValueCurveAtTime(e, r, n, o = 1) {
      n = this.toSeconds(n), r = this.toSeconds(r);
      let s = this._fromType(e[0]) * o;
      this.setValueAtTime(this._toType(s), r);
      let i = n / (e.length - 1);
      for (let a = 1; a < e.length; a++) {
        let l = this._fromType(e[a]) * o;
        this.linearRampToValueAtTime(this._toType(l), r + a * i);
      }
      return this;
    }
    cancelScheduledValues(e) {
      let r = this.toSeconds(e);
      return Q(isFinite(r), `Invalid argument to cancelScheduledValues: ${JSON.stringify(e)}`), this._events.cancel(r), this._param.cancelScheduledValues(r), this.log(this.units, "cancelScheduledValues", r), this;
    }
    cancelAndHoldAtTime(e) {
      let r = this.toSeconds(e), n = this._fromType(this.getValueAtTime(r));
      Q(isFinite(r), `Invalid argument to cancelAndHoldAtTime: ${JSON.stringify(e)}`), this.log(this.units, "cancelAndHoldAtTime", r, "value=" + n);
      let o = this._events.get(r), s = this._events.getAfter(r);
      return o && vt(o.time, r) ? s ? (this._param.cancelScheduledValues(s.time), this._events.cancel(s.time)) : (this._param.cancelAndHoldAtTime(r), this._events.cancel(r + this.sampleTime)) : s && (this._param.cancelScheduledValues(s.time), this._events.cancel(s.time), s.type === "linearRampToValueAtTime" ? this.linearRampToValueAtTime(this._toType(n), r) : s.type === "exponentialRampToValueAtTime" && this.exponentialRampToValueAtTime(this._toType(n), r)), this._events.add({ time: r, type: "setValueAtTime", value: n }), this._param.setValueAtTime(n, r), this;
    }
    rampTo(e, r = 0.1, n) {
      return this.units === "frequency" || this.units === "bpm" || this.units === "decibels" ? this.exponentialRampTo(e, r, n) : this.linearRampTo(e, r, n), this;
    }
    apply(e) {
      let r = this.context.currentTime;
      e.setValueAtTime(this.getValueAtTime(r), r);
      let n = this._events.get(r);
      if (n && n.type === "setTargetAtTime") {
        let o = this._events.getAfter(n.time), s = o ? o.time : r + 2, i = (s - r) / 10;
        for (let a = r; a < s; a += i) e.linearRampToValueAtTime(this.getValueAtTime(a), a);
      }
      return this._events.forEachAfter(this.context.currentTime, (o) => {
        o.type === "cancelScheduledValues" ? e.cancelScheduledValues(o.time) : o.type === "setTargetAtTime" ? e.setTargetAtTime(o.value, o.time, o.constant) : e[o.type](o.value, o.time);
      }), this;
    }
    setParam(e) {
      Q(this._swappable, "The Param must be assigned as 'swappable' in the constructor");
      let r = this.input;
      return r.disconnect(this._param), this.apply(e), this._param = e, r.connect(this._param), this;
    }
    dispose() {
      return super.dispose(), this._events.dispose(), this;
    }
    get defaultValue() {
      return this._toType(this._param.defaultValue);
    }
    _exponentialApproach(e, r, n, o, s) {
      return n + (r - n) * Math.exp(-(s - e) / o);
    }
    _linearInterpolate(e, r, n, o, s) {
      return r + (o - r) * ((s - e) / (n - e));
    }
    _exponentialInterpolate(e, r, n, o, s) {
      return r * Math.pow(o / r, (s - e) / (n - e));
    }
  };
  var V = class t extends ze {
    constructor() {
      super(...arguments), this._internalChannels = [];
    }
    get numberOfInputs() {
      return X(this.input) ? xr(this.input) || this.input instanceof te ? 1 : this.input.numberOfInputs : 0;
    }
    get numberOfOutputs() {
      return X(this.output) ? this.output.numberOfOutputs : 0;
    }
    _isAudioNode(e) {
      return X(e) && (e instanceof t || Ir(e));
    }
    _getInternalNodes() {
      let e = this._internalChannels.slice(0);
      return this._isAudioNode(this.input) && e.push(this.input), this._isAudioNode(this.output) && this.input !== this.output && e.push(this.output), e;
    }
    _setChannelProperties(e) {
      this._getInternalNodes().forEach((n) => {
        n.channelCount = e.channelCount, n.channelCountMode = e.channelCountMode, n.channelInterpretation = e.channelInterpretation;
      });
    }
    _getChannelProperties() {
      let e = this._getInternalNodes();
      Q(e.length > 0, "ToneAudioNode does not have any internal nodes");
      let r = e[0];
      return { channelCount: r.channelCount, channelCountMode: r.channelCountMode, channelInterpretation: r.channelInterpretation };
    }
    get channelCount() {
      return this._getChannelProperties().channelCount;
    }
    set channelCount(e) {
      let r = this._getChannelProperties();
      this._setChannelProperties(Object.assign(r, { channelCount: e }));
    }
    get channelCountMode() {
      return this._getChannelProperties().channelCountMode;
    }
    set channelCountMode(e) {
      let r = this._getChannelProperties();
      this._setChannelProperties(Object.assign(r, { channelCountMode: e }));
    }
    get channelInterpretation() {
      return this._getChannelProperties().channelInterpretation;
    }
    set channelInterpretation(e) {
      let r = this._getChannelProperties();
      this._setChannelProperties(Object.assign(r, { channelInterpretation: e }));
    }
    connect(e, r = 0, n = 0) {
      return wt(this, e, r, n), this;
    }
    toDestination() {
      return this.connect(this.context.destination), this;
    }
    toMaster() {
      return us("toMaster() has been renamed toDestination()"), this.toDestination();
    }
    disconnect(e, r = 0, n = 0) {
      return wv(this, e, r, n), this;
    }
    chain(...e) {
      return vr(this, ...e), this;
    }
    fan(...e) {
      return e.forEach((r) => this.connect(r)), this;
    }
    dispose() {
      return super.dispose(), X(this.input) && (this.input instanceof t ? this.input.dispose() : Ir(this.input) && this.input.disconnect()), X(this.output) && (this.output instanceof t ? this.output.dispose() : Ir(this.output) && this.output.disconnect()), this._internalChannels = [], this;
    }
  };
  function vr(...t) {
    let e = t.shift();
    t.reduce((r, n) => (r instanceof V ? r.connect(n) : Ir(r) && wt(r, n), n), e);
  }
  function wt(t, e, r = 0, n = 0) {
    for (Q(X(t), "Cannot connect from undefined node"), Q(X(e), "Cannot connect to undefined node"), (e instanceof V || Ir(e)) && Q(e.numberOfInputs > 0, "Cannot connect to node with no inputs"), Q(t.numberOfOutputs > 0, "Cannot connect from node with no outputs"); e instanceof V || e instanceof te; ) X(e.input) && (e = e.input);
    for (; t instanceof V; ) X(t.output) && (t = t.output);
    xr(e) ? t.connect(e, r) : t.connect(e, r, n);
  }
  function wv(t, e, r = 0, n = 0) {
    if (X(e)) for (; e instanceof V; ) e = e.input;
    for (; !Ir(t); ) X(t.output) && (t = t.output);
    xr(e) ? t.disconnect(e, r) : Ir(e) ? t.disconnect(e, r, n) : t.disconnect();
  }
  var H = class t extends V {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["gain", "units"]);
      super(e), this.name = "Gain", this._gainNode = this.context.createGain(), this.input = this._gainNode, this.output = this._gainNode, this.gain = new te({ context: this.context, convert: e.convert, param: this._gainNode.gain, units: e.units, value: e.gain, minValue: e.minValue, maxValue: e.maxValue }), z(this, "gain");
    }
    static getDefaults() {
      return Object.assign(V.getDefaults(), { convert: true, gain: 1, units: "gain" });
    }
    dispose() {
      return super.dispose(), this._gainNode.disconnect(), this.gain.dispose(), this;
    }
  };
  var wr = class extends V {
    constructor(e) {
      super(e), this.onended = Z, this._startTime = -1, this._stopTime = -1, this._timeout = -1, this.output = new H({ context: this.context, gain: 0 }), this._gainNode = this.output, this.getStateAtTime = function(r) {
        let n = this.toSeconds(r);
        return this._startTime !== -1 && n >= this._startTime && (this._stopTime === -1 || n <= this._stopTime) ? "started" : "stopped";
      }, this._fadeIn = e.fadeIn, this._fadeOut = e.fadeOut, this._curve = e.curve, this.onended = e.onended;
    }
    static getDefaults() {
      return Object.assign(V.getDefaults(), { curve: "linear", fadeIn: 0, fadeOut: 0, onended: Z });
    }
    _startGain(e, r = 1) {
      Q(this._startTime === -1, "Source cannot be started more than once");
      let n = this.toSeconds(this._fadeIn);
      return this._startTime = e + n, this._startTime = Math.max(this._startTime, this.context.currentTime), n > 0 ? (this._gainNode.gain.setValueAtTime(0, e), this._curve === "linear" ? this._gainNode.gain.linearRampToValueAtTime(r, e + n) : this._gainNode.gain.exponentialApproachValueAtTime(r, e, n)) : this._gainNode.gain.setValueAtTime(r, e), this;
    }
    stop(e) {
      return this.log("stop", e), this._stopGain(this.toSeconds(e)), this;
    }
    _stopGain(e) {
      Q(this._startTime !== -1, "'start' must be called before 'stop'"), this.cancelStop();
      let r = this.toSeconds(this._fadeOut);
      return this._stopTime = this.toSeconds(e) + r, this._stopTime = Math.max(this._stopTime, this.now()), r > 0 ? this._curve === "linear" ? this._gainNode.gain.linearRampTo(0, r, e) : this._gainNode.gain.targetRampTo(0, r, e) : (this._gainNode.gain.cancelAndHoldAtTime(e), this._gainNode.gain.setValueAtTime(0, e)), this.context.clearTimeout(this._timeout), this._timeout = this.context.setTimeout(() => {
        let n = this._curve === "exponential" ? r * 2 : 0;
        this._stopSource(this.now() + n), this._onended();
      }, this._stopTime - this.context.currentTime), this;
    }
    _onended() {
      if (this.onended !== Z && (this.onended(this), this.onended = Z, !this.context.isOffline)) {
        let e = () => this.dispose();
        typeof requestIdleCallback < "u" ? requestIdleCallback(e) : setTimeout(e, 10);
      }
    }
    get state() {
      return this.getStateAtTime(this.now());
    }
    cancelStop() {
      return this.log("cancelStop"), Q(this._startTime !== -1, "Source is not started"), this._gainNode.gain.cancelScheduledValues(this._startTime + this.sampleTime), this.context.clearTimeout(this._timeout), this._stopTime = -1, this;
    }
    dispose() {
      return super.dispose(), this._gainNode.dispose(), this.onended = Z, this;
    }
  };
  var Vi = class t extends wr {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["offset"]);
      super(e), this.name = "ToneConstantSource", this._source = this.context.createConstantSource(), wt(this._source, this._gainNode), this.offset = new te({ context: this.context, convert: e.convert, param: this._source.offset, units: e.units, value: e.offset, minValue: e.minValue, maxValue: e.maxValue });
    }
    static getDefaults() {
      return Object.assign(wr.getDefaults(), { convert: true, offset: 1, units: "number" });
    }
    start(e) {
      let r = this.toSeconds(e);
      return this.log("start", r), this._startGain(r), this._source.start(r), this;
    }
    _stopSource(e) {
      this._source.stop(e);
    }
    dispose() {
      return super.dispose(), this.state === "started" && this.stop(), this._source.disconnect(), this.offset.dispose(), this;
    }
  };
  var J = class t extends V {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["value", "units"]);
      super(e), this.name = "Signal", this.override = true, this.output = this._constantSource = new Vi({ context: this.context, convert: e.convert, offset: e.value, units: e.units, minValue: e.minValue, maxValue: e.maxValue }), this._constantSource.start(0), this.input = this._param = this._constantSource.offset;
    }
    static getDefaults() {
      return Object.assign(V.getDefaults(), { convert: true, units: "number", value: 0 });
    }
    connect(e, r = 0, n = 0) {
      return ms(this, e, r, n), this;
    }
    dispose() {
      return super.dispose(), this._param.dispose(), this._constantSource.dispose(), this;
    }
    setValueAtTime(e, r) {
      return this._param.setValueAtTime(e, r), this;
    }
    getValueAtTime(e) {
      return this._param.getValueAtTime(e);
    }
    setRampPoint(e) {
      return this._param.setRampPoint(e), this;
    }
    linearRampToValueAtTime(e, r) {
      return this._param.linearRampToValueAtTime(e, r), this;
    }
    exponentialRampToValueAtTime(e, r) {
      return this._param.exponentialRampToValueAtTime(e, r), this;
    }
    exponentialRampTo(e, r, n) {
      return this._param.exponentialRampTo(e, r, n), this;
    }
    linearRampTo(e, r, n) {
      return this._param.linearRampTo(e, r, n), this;
    }
    targetRampTo(e, r, n) {
      return this._param.targetRampTo(e, r, n), this;
    }
    exponentialApproachValueAtTime(e, r, n) {
      return this._param.exponentialApproachValueAtTime(e, r, n), this;
    }
    setTargetAtTime(e, r, n) {
      return this._param.setTargetAtTime(e, r, n), this;
    }
    setValueCurveAtTime(e, r, n, o) {
      return this._param.setValueCurveAtTime(e, r, n, o), this;
    }
    cancelScheduledValues(e) {
      return this._param.cancelScheduledValues(e), this;
    }
    cancelAndHoldAtTime(e) {
      return this._param.cancelAndHoldAtTime(e), this;
    }
    rampTo(e, r, n) {
      return this._param.rampTo(e, r, n), this;
    }
    get value() {
      return this._param.value;
    }
    set value(e) {
      this._param.value = e;
    }
    get convert() {
      return this._param.convert;
    }
    set convert(e) {
      this._param.convert = e;
    }
    get units() {
      return this._param.units;
    }
    get overridden() {
      return this._param.overridden;
    }
    set overridden(e) {
      this._param.overridden = e;
    }
    get maxValue() {
      return this._param.maxValue;
    }
    get minValue() {
      return this._param.minValue;
    }
    apply(e) {
      return this._param.apply(e), this;
    }
  };
  function ms(t, e, r, n) {
    (e instanceof te || xr(e) || e instanceof J && e.override) && (e.cancelScheduledValues(0), e.setValueAtTime(0, 0), e instanceof J && (e.overridden = true)), wt(t, e, r, n);
  }
  var Ll = class t extends te {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["value"]);
      super(e), this.name = "TickParam", this._events = new je(1 / 0), this._multiplier = 1, this._multiplier = e.multiplier, this._events.cancel(0), this._events.add({ ticks: 0, time: 0, type: "setValueAtTime", value: this._fromType(e.value) }), this.setValueAtTime(e.value, 0);
    }
    static getDefaults() {
      return Object.assign(te.getDefaults(), { multiplier: 1, units: "hertz", value: 1 });
    }
    setTargetAtTime(e, r, n) {
      r = this.toSeconds(r), this.setRampPoint(r);
      let o = this._fromType(e), s = this._events.get(r), i = Math.round(Math.max(1 / n, 1));
      for (let a = 0; a <= i; a++) {
        let l = n * a + r, u = this._exponentialApproach(s.time, s.value, o, n, l);
        this.linearRampToValueAtTime(this._toType(u), l);
      }
      return this;
    }
    setValueAtTime(e, r) {
      let n = this.toSeconds(r);
      super.setValueAtTime(e, r);
      let o = this._events.get(n), s = this._events.previousEvent(o), i = this._getTicksUntilEvent(s, n);
      return o.ticks = Math.max(i, 0), this;
    }
    linearRampToValueAtTime(e, r) {
      let n = this.toSeconds(r);
      super.linearRampToValueAtTime(e, r);
      let o = this._events.get(n), s = this._events.previousEvent(o), i = this._getTicksUntilEvent(s, n);
      return o.ticks = Math.max(i, 0), this;
    }
    exponentialRampToValueAtTime(e, r) {
      r = this.toSeconds(r);
      let n = this._fromType(e), o = this._events.get(r), s = Math.round(Math.max((r - o.time) * 10, 1)), i = (r - o.time) / s;
      for (let a = 0; a <= s; a++) {
        let l = i * a + o.time, u = this._exponentialInterpolate(o.time, o.value, r, n, l);
        this.linearRampToValueAtTime(this._toType(u), l);
      }
      return this;
    }
    _getTicksUntilEvent(e, r) {
      if (e === null) e = { ticks: 0, time: 0, type: "setValueAtTime", value: 0 };
      else if (Ie(e.ticks)) {
        let i = this._events.previousEvent(e);
        e.ticks = this._getTicksUntilEvent(i, e.time);
      }
      let n = this._fromType(this.getValueAtTime(e.time)), o = this._fromType(this.getValueAtTime(r)), s = this._events.get(r);
      return s && s.time === r && s.type === "setValueAtTime" && (o = this._fromType(this.getValueAtTime(r - this.sampleTime))), 0.5 * (r - e.time) * (n + o) + e.ticks;
    }
    getTicksAtTime(e) {
      let r = this.toSeconds(e), n = this._events.get(r);
      return Math.max(this._getTicksUntilEvent(n, r), 0);
    }
    getDurationOfTicks(e, r) {
      let n = this.toSeconds(r), o = this.getTicksAtTime(r);
      return this.getTimeOfTick(o + e) - n;
    }
    getTimeOfTick(e) {
      let r = this._events.get(e, "ticks"), n = this._events.getAfter(e, "ticks");
      if (r && r.ticks === e) return r.time;
      if (r && n && n.type === "linearRampToValueAtTime" && r.value !== n.value) {
        let o = this._fromType(this.getValueAtTime(r.time)), i = (this._fromType(this.getValueAtTime(n.time)) - o) / (n.time - r.time), a = Math.sqrt(Math.pow(o, 2) - 2 * i * (r.ticks - e)), l = (-o + a) / i, u = (-o - a) / i;
        return (l > 0 ? l : u) + r.time;
      } else return r ? r.value === 0 ? 1 / 0 : r.time + (e - r.ticks) / r.value : e / this._initialValue;
    }
    ticksToTime(e, r) {
      return this.getDurationOfTicks(e, r);
    }
    timeToTicks(e, r) {
      let n = this.toSeconds(r), o = this.toSeconds(e), s = this.getTicksAtTime(n);
      return this.getTicksAtTime(n + o) - s;
    }
    _fromType(e) {
      return this.units === "bpm" && this.multiplier ? 1 / (60 / e / this.multiplier) : super._fromType(e);
    }
    _toType(e) {
      return this.units === "bpm" && this.multiplier ? e / this.multiplier * 60 : super._toType(e);
    }
    get multiplier() {
      return this._multiplier;
    }
    set multiplier(e) {
      let r = this.value;
      this._multiplier = e, this.cancelScheduledValues(0), this.setValueAtTime(r, 0);
    }
  };
  var ql = class t extends J {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["value"]);
      super(e), this.name = "TickSignal", this.input = this._param = new Ll({ context: this.context, convert: e.convert, multiplier: e.multiplier, param: this._constantSource.offset, units: e.units, value: e.value });
    }
    static getDefaults() {
      return Object.assign(J.getDefaults(), { multiplier: 1, units: "hertz", value: 1 });
    }
    ticksToTime(e, r) {
      return this._param.ticksToTime(e, r);
    }
    timeToTicks(e, r) {
      return this._param.timeToTicks(e, r);
    }
    getTimeOfTick(e) {
      return this._param.getTimeOfTick(e);
    }
    getDurationOfTicks(e, r) {
      return this._param.getDurationOfTicks(e, r);
    }
    getTicksAtTime(e) {
      return this._param.getTicksAtTime(e);
    }
    get multiplier() {
      return this._param.multiplier;
    }
    set multiplier(e) {
      this._param.multiplier = e;
    }
    dispose() {
      return super.dispose(), this._param.dispose(), this;
    }
  };
  var jl = class t extends ze {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["frequency"]);
      super(e), this.name = "TickSource", this._state = new Lr(), this._tickOffset = new je(), this._ticksAtTime = new je(), this._secondsAtTime = new je(), this.frequency = new ql({ context: this.context, units: e.units, value: e.frequency }), z(this, "frequency"), this._state.setStateAtTime("stopped", 0), this.setTicksAtTime(0, 0);
    }
    static getDefaults() {
      return Object.assign({ frequency: 1, units: "hertz" }, ze.getDefaults());
    }
    get state() {
      return this.getStateAtTime(this.now());
    }
    start(e, r) {
      let n = this.toSeconds(e);
      return this._state.getValueAtTime(n) !== "started" && (this._state.setStateAtTime("started", n), X(r) && this.setTicksAtTime(r, n), this._ticksAtTime.cancel(n), this._secondsAtTime.cancel(n)), this;
    }
    stop(e) {
      let r = this.toSeconds(e);
      if (this._state.getValueAtTime(r) === "stopped") {
        let n = this._state.get(r);
        n && n.time > 0 && (this._tickOffset.cancel(n.time), this._state.cancel(n.time));
      }
      return this._state.cancel(r), this._state.setStateAtTime("stopped", r), this.setTicksAtTime(0, r), this._ticksAtTime.cancel(r), this._secondsAtTime.cancel(r), this;
    }
    pause(e) {
      let r = this.toSeconds(e);
      return this._state.getValueAtTime(r) === "started" && (this._state.setStateAtTime("paused", r), this._ticksAtTime.cancel(r), this._secondsAtTime.cancel(r)), this;
    }
    cancel(e) {
      return e = this.toSeconds(e), this._state.cancel(e), this._tickOffset.cancel(e), this._ticksAtTime.cancel(e), this._secondsAtTime.cancel(e), this;
    }
    getTicksAtTime(e) {
      let r = this.toSeconds(e), n = this._state.getLastState("stopped", r), o = this._ticksAtTime.get(r), s = { state: "paused", time: r };
      this._state.add(s);
      let i = o || n, a = o ? o.ticks : 0, l = null;
      return this._state.forEachBetween(i.time, r + this.sampleTime, (u) => {
        let c = i.time, h = this._tickOffset.get(u.time);
        h && h.time >= i.time && (a = h.ticks, c = h.time), i.state === "started" && u.state !== "started" && (a += this.frequency.getTicksAtTime(u.time) - this.frequency.getTicksAtTime(c), u.time !== s.time && (l = { state: u.state, time: u.time, ticks: a })), i = u;
      }), this._state.remove(s), l && this._ticksAtTime.add(l), a;
    }
    get ticks() {
      return this.getTicksAtTime(this.now());
    }
    set ticks(e) {
      this.setTicksAtTime(e, this.now());
    }
    get seconds() {
      return this.getSecondsAtTime(this.now());
    }
    set seconds(e) {
      let r = this.now(), n = this.frequency.timeToTicks(e, r);
      this.setTicksAtTime(n, r);
    }
    getSecondsAtTime(e) {
      e = this.toSeconds(e);
      let r = this._state.getLastState("stopped", e), n = { state: "paused", time: e };
      this._state.add(n);
      let o = this._secondsAtTime.get(e), s = o || r, i = o ? o.seconds : 0, a = null;
      return this._state.forEachBetween(s.time, e + this.sampleTime, (l) => {
        let u = s.time, c = this._tickOffset.get(l.time);
        c && c.time >= s.time && (i = c.seconds, u = c.time), s.state === "started" && l.state !== "started" && (i += l.time - u, l.time !== n.time && (a = { state: l.state, time: l.time, seconds: i })), s = l;
      }), this._state.remove(n), a && this._secondsAtTime.add(a), i;
    }
    setTicksAtTime(e, r) {
      return r = this.toSeconds(r), this._tickOffset.cancel(r), this._tickOffset.add({ seconds: this.frequency.getDurationOfTicks(e, r), ticks: e, time: r }), this._ticksAtTime.cancel(r), this._secondsAtTime.cancel(r), this;
    }
    getStateAtTime(e) {
      return e = this.toSeconds(e), this._state.getValueAtTime(e);
    }
    getTimeOfTick(e, r = this.now()) {
      let n = this._tickOffset.get(r), o = this._state.get(r), s = Math.max(n.time, o.time), i = this.frequency.getTicksAtTime(s) + e - n.ticks;
      return this.frequency.getTimeOfTick(i);
    }
    forEachTickBetween(e, r, n) {
      let o = this._state.get(e);
      this._state.forEachBetween(e, r, (i) => {
        o && o.state === "started" && i.state !== "started" && this.forEachTickBetween(Math.max(o.time, e), i.time - this.sampleTime, n), o = i;
      });
      let s = null;
      if (o && o.state === "started") {
        let i = Math.max(o.time, e), a = this.frequency.getTicksAtTime(i), l = this.frequency.getTicksAtTime(o.time), u = a - l, c = Math.ceil(u) - u;
        c = vt(c, 1) ? 0 : c;
        let h = this.frequency.getTimeOfTick(a + c);
        for (; h < r; ) {
          try {
            n(h, Math.round(this.getTicksAtTime(h)));
          } catch (p) {
            s = p;
            break;
          }
          h += this.frequency.getDurationOfTicks(1, h);
        }
      }
      if (s) throw s;
      return this;
    }
    dispose() {
      return super.dispose(), this._state.dispose(), this._tickOffset.dispose(), this._ticksAtTime.dispose(), this._secondsAtTime.dispose(), this.frequency.dispose(), this;
    }
  };
  var gs = class t extends ze {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["callback", "frequency"]);
      super(e), this.name = "Clock", this.callback = Z, this._lastUpdate = 0, this._state = new Lr("stopped"), this._boundLoop = this._loop.bind(this), this.callback = e.callback, this._tickSource = new jl({ context: this.context, frequency: e.frequency, units: e.units }), this._lastUpdate = 0, this.frequency = this._tickSource.frequency, z(this, "frequency"), this._state.setStateAtTime("stopped", 0), this.context.on("tick", this._boundLoop);
    }
    static getDefaults() {
      return Object.assign(ze.getDefaults(), { callback: Z, frequency: 1, units: "hertz" });
    }
    get state() {
      return this._state.getValueAtTime(this.now());
    }
    start(e, r) {
      Ml(this.context);
      let n = this.toSeconds(e);
      return this.log("start", n), this._state.getValueAtTime(n) !== "started" && (this._state.setStateAtTime("started", n), this._tickSource.start(n, r), n < this._lastUpdate && this.emit("start", n, r)), this;
    }
    stop(e) {
      let r = this.toSeconds(e);
      return this.log("stop", r), this._state.cancel(r), this._state.setStateAtTime("stopped", r), this._tickSource.stop(r), r < this._lastUpdate && this.emit("stop", r), this;
    }
    pause(e) {
      let r = this.toSeconds(e);
      return this._state.getValueAtTime(r) === "started" && (this._state.setStateAtTime("paused", r), this._tickSource.pause(r), r < this._lastUpdate && this.emit("pause", r)), this;
    }
    get ticks() {
      return Math.ceil(this.getTicksAtTime(this.now()));
    }
    set ticks(e) {
      this._tickSource.ticks = e;
    }
    get seconds() {
      return this._tickSource.seconds;
    }
    set seconds(e) {
      this._tickSource.seconds = e;
    }
    getSecondsAtTime(e) {
      return this._tickSource.getSecondsAtTime(e);
    }
    setTicksAtTime(e, r) {
      return this._tickSource.setTicksAtTime(e, r), this;
    }
    getTimeOfTick(e, r = this.now()) {
      return this._tickSource.getTimeOfTick(e, r);
    }
    getTicksAtTime(e) {
      return this._tickSource.getTicksAtTime(e);
    }
    nextTickTime(e, r) {
      let n = this.toSeconds(r), o = this.getTicksAtTime(n);
      return this._tickSource.getTimeOfTick(o + e, n);
    }
    _loop() {
      let e = this._lastUpdate, r = this.now();
      this._lastUpdate = r, this.log("loop", e, r), e !== r && (this._state.forEachBetween(e, r, (n) => {
        switch (n.state) {
          case "started":
            let o = this._tickSource.getTicksAtTime(n.time);
            this.emit("start", n.time, o);
            break;
          case "stopped":
            n.time !== 0 && this.emit("stop", n.time);
            break;
          case "paused":
            this.emit("pause", n.time);
            break;
        }
      }), this._tickSource.forEachTickBetween(e, r, (n, o) => {
        this.callback(n, o);
      }));
    }
    getStateAtTime(e) {
      let r = this.toSeconds(e);
      return this._state.getValueAtTime(r);
    }
    dispose() {
      return super.dispose(), this.context.off("tick", this._boundLoop), this._tickSource.dispose(), this._state.dispose(), this;
    }
  };
  Vn.mixin(gs);
  var or = class t extends V {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["volume"]);
      super(e), this.name = "Volume", this.input = this.output = new H({ context: this.context, gain: e.volume, units: "decibels" }), this.volume = this.output.gain, z(this, "volume"), this._unmutedVolume = e.volume, this.mute = e.mute;
    }
    static getDefaults() {
      return Object.assign(V.getDefaults(), { mute: false, volume: 0 });
    }
    get mute() {
      return this.volume.value === -1 / 0;
    }
    set mute(e) {
      !this.mute && e ? (this._unmutedVolume = this.volume.value, this.volume.value = -1 / 0) : this.mute && !e && (this.volume.value = this._unmutedVolume);
    }
    dispose() {
      return super.dispose(), this.input.dispose(), this.volume.dispose(), this;
    }
  };
  var lp = class t extends V {
    constructor() {
      let e = O(t.getDefaults(), arguments);
      super(e), this.name = "Destination", this.input = new or({ context: this.context }), this.output = new H({ context: this.context }), this.volume = this.input.volume, vr(this.input, this.output, this.context.rawContext.destination), this.mute = e.mute, this._internalChannels = [this.input, this.context.rawContext.destination, this.output];
    }
    static getDefaults() {
      return Object.assign(V.getDefaults(), { mute: false, volume: 0 });
    }
    get mute() {
      return this.input.mute;
    }
    set mute(e) {
      this.input.mute = e;
    }
    chain(...e) {
      return this.input.disconnect(), e.unshift(this.input), e.push(this.output), vr(...e), this;
    }
    get maxChannelCount() {
      return this.context.rawContext.destination.maxChannelCount;
    }
    dispose() {
      return super.dispose(), this.volume.dispose(), this;
    }
  };
  In((t) => {
    t.destination = new lp({ context: t });
  });
  Pn((t) => {
    t.destination.dispose();
  });
  var up = class extends V {
    constructor() {
      super(...arguments), this.name = "Listener", this.positionX = new te({ context: this.context, param: this.context.rawContext.listener.positionX }), this.positionY = new te({ context: this.context, param: this.context.rawContext.listener.positionY }), this.positionZ = new te({ context: this.context, param: this.context.rawContext.listener.positionZ }), this.forwardX = new te({ context: this.context, param: this.context.rawContext.listener.forwardX }), this.forwardY = new te({ context: this.context, param: this.context.rawContext.listener.forwardY }), this.forwardZ = new te({ context: this.context, param: this.context.rawContext.listener.forwardZ }), this.upX = new te({ context: this.context, param: this.context.rawContext.listener.upX }), this.upY = new te({ context: this.context, param: this.context.rawContext.listener.upY }), this.upZ = new te({ context: this.context, param: this.context.rawContext.listener.upZ });
    }
    static getDefaults() {
      return Object.assign(V.getDefaults(), { positionX: 0, positionY: 0, positionZ: 0, forwardX: 0, forwardY: 0, forwardZ: -1, upX: 0, upY: 1, upZ: 0 });
    }
    dispose() {
      return super.dispose(), this.positionX.dispose(), this.positionY.dispose(), this.positionZ.dispose(), this.forwardX.dispose(), this.forwardY.dispose(), this.forwardZ.dispose(), this.upX.dispose(), this.upY.dispose(), this.upZ.dispose(), this;
    }
  };
  In((t) => {
    t.listener = new up({ context: t });
  });
  Pn((t) => {
    t.listener.dispose();
  });
  var _s = class t extends $e {
    constructor() {
      super(), this.name = "ToneAudioBuffers", this._buffers = /* @__PURE__ */ new Map(), this._loadingCount = 0;
      let e = O(t.getDefaults(), arguments, ["urls", "onload", "baseUrl"], "urls");
      this.baseUrl = e.baseUrl, Object.keys(e.urls).forEach((r) => {
        this._loadingCount++;
        let n = e.urls[r];
        this.add(r, n, this._bufferLoaded.bind(this, e.onload), e.onerror);
      });
    }
    static getDefaults() {
      return { baseUrl: "", onerror: Z, onload: Z, urls: {} };
    }
    has(e) {
      return this._buffers.has(e.toString());
    }
    get(e) {
      return Q(this.has(e), `ToneAudioBuffers has no buffer named: ${e}`), this._buffers.get(e.toString());
    }
    _bufferLoaded(e) {
      this._loadingCount--, this._loadingCount === 0 && e && e();
    }
    get loaded() {
      return Array.from(this._buffers).every(([e, r]) => r.loaded);
    }
    add(e, r, n = Z, o = Z) {
      return ct(r) ? (this.baseUrl && r.trim().substring(0, 11).toLowerCase() === "data:audio/" && (this.baseUrl = ""), this._buffers.set(e.toString(), new Ye(this.baseUrl + r, n, o))) : this._buffers.set(e.toString(), new Ye(r, n, o)), this;
    }
    dispose() {
      return super.dispose(), this._buffers.forEach((e) => e.dispose()), this._buffers.clear(), this;
    }
  };
  var zt = class extends nr {
    constructor() {
      super(...arguments), this.name = "Ticks", this.defaultUnits = "i";
    }
    _now() {
      return this.context.transport.ticks;
    }
    _beatsToUnits(e) {
      return this._getPPQ() * e;
    }
    _secondsToUnits(e) {
      return Math.floor(e / (60 / this._getBpm()) * this._getPPQ());
    }
    _ticksToUnits(e) {
      return e;
    }
    toTicks() {
      return this.valueOf();
    }
    toSeconds() {
      return this.valueOf() / this._getPPQ() * (60 / this._getBpm());
    }
  };
  var cp = class extends ze {
    constructor() {
      super(...arguments), this.name = "Draw", this.expiration = 0.25, this.anticipation = 8e-3, this._events = new je(), this._boundDrawLoop = this._drawLoop.bind(this), this._animationFrame = -1;
    }
    schedule(e, r) {
      return this._events.add({ callback: e, time: this.toSeconds(r) }), this._events.length === 1 && (this._animationFrame = requestAnimationFrame(this._boundDrawLoop)), this;
    }
    cancel(e) {
      return this._events.cancel(this.toSeconds(e)), this;
    }
    _drawLoop() {
      let e = this.context.currentTime;
      this._events.forEachBefore(e + this.anticipation, (r) => {
        e - r.time <= this.expiration && r.callback(), this._events.remove(r);
      }), this._events.length > 0 && (this._animationFrame = requestAnimationFrame(this._boundDrawLoop));
    }
    dispose() {
      return super.dispose(), this._events.dispose(), cancelAnimationFrame(this._animationFrame), this;
    }
  };
  In((t) => {
    t.draw = new cp({ context: t });
  });
  Pn((t) => {
    t.draw.dispose();
  });
  var zl = class extends $e {
    constructor() {
      super(...arguments), this.name = "IntervalTimeline", this._root = null, this._length = 0;
    }
    add(e) {
      Q(X(e.time), "Events must have a time property"), Q(X(e.duration), "Events must have a duration parameter"), e.time = e.time.valueOf();
      let r = new hp(e.time, e.time + e.duration, e);
      for (this._root === null ? this._root = r : this._root.insert(r), this._length++; r !== null; ) r.updateHeight(), r.updateMax(), this._rebalance(r), r = r.parent;
      return this;
    }
    remove(e) {
      if (this._root !== null) {
        let r = [];
        this._root.search(e.time, r);
        for (let n of r) if (n.event === e) {
          this._removeNode(n), this._length--;
          break;
        }
      }
      return this;
    }
    get length() {
      return this._length;
    }
    cancel(e) {
      return this.forEachFrom(e, (r) => this.remove(r)), this;
    }
    _setRoot(e) {
      this._root = e, this._root !== null && (this._root.parent = null);
    }
    _replaceNodeInParent(e, r) {
      e.parent !== null ? (e.isLeftChild() ? e.parent.left = r : e.parent.right = r, this._rebalance(e.parent)) : this._setRoot(r);
    }
    _removeNode(e) {
      if (e.left === null && e.right === null) this._replaceNodeInParent(e, null);
      else if (e.right === null) this._replaceNodeInParent(e, e.left);
      else if (e.left === null) this._replaceNodeInParent(e, e.right);
      else {
        let r = e.getBalance(), n, o = null;
        if (r > 0) if (e.left.right === null) n = e.left, n.right = e.right, o = n;
        else {
          for (n = e.left.right; n.right !== null; ) n = n.right;
          n.parent && (n.parent.right = n.left, o = n.parent, n.left = e.left, n.right = e.right);
        }
        else if (e.right.left === null) n = e.right, n.left = e.left, o = n;
        else {
          for (n = e.right.left; n.left !== null; ) n = n.left;
          n.parent && (n.parent.left = n.right, o = n.parent, n.left = e.left, n.right = e.right);
        }
        e.parent !== null ? e.isLeftChild() ? e.parent.left = n : e.parent.right = n : this._setRoot(n), o && this._rebalance(o);
      }
      e.dispose();
    }
    _rotateLeft(e) {
      let r = e.parent, n = e.isLeftChild(), o = e.right;
      o && (e.right = o.left, o.left = e), r !== null ? n ? r.left = o : r.right = o : this._setRoot(o);
    }
    _rotateRight(e) {
      let r = e.parent, n = e.isLeftChild(), o = e.left;
      o && (e.left = o.right, o.right = e), r !== null ? n ? r.left = o : r.right = o : this._setRoot(o);
    }
    _rebalance(e) {
      let r = e.getBalance();
      r > 1 && e.left ? e.left.getBalance() < 0 ? this._rotateLeft(e.left) : this._rotateRight(e) : r < -1 && e.right && (e.right.getBalance() > 0 ? this._rotateRight(e.right) : this._rotateLeft(e));
    }
    get(e) {
      if (this._root !== null) {
        let r = [];
        if (this._root.search(e, r), r.length > 0) {
          let n = r[0];
          for (let o = 1; o < r.length; o++) r[o].low > n.low && (n = r[o]);
          return n.event;
        }
      }
      return null;
    }
    forEach(e) {
      if (this._root !== null) {
        let r = [];
        this._root.traverse((n) => r.push(n)), r.forEach((n) => {
          n.event && e(n.event);
        });
      }
      return this;
    }
    forEachAtTime(e, r) {
      if (this._root !== null) {
        let n = [];
        this._root.search(e, n), n.forEach((o) => {
          o.event && r(o.event);
        });
      }
      return this;
    }
    forEachFrom(e, r) {
      if (this._root !== null) {
        let n = [];
        this._root.searchAfter(e, n), n.forEach((o) => {
          o.event && r(o.event);
        });
      }
      return this;
    }
    dispose() {
      return super.dispose(), this._root !== null && this._root.traverse((e) => e.dispose()), this._root = null, this;
    }
  }, hp = class {
    constructor(e, r, n) {
      this._left = null, this._right = null, this.parent = null, this.height = 0, this.event = n, this.low = e, this.high = r, this.max = this.high;
    }
    insert(e) {
      e.low <= this.low ? this.left === null ? this.left = e : this.left.insert(e) : this.right === null ? this.right = e : this.right.insert(e);
    }
    search(e, r) {
      e > this.max || (this.left !== null && this.left.search(e, r), this.low <= e && this.high > e && r.push(this), !(this.low > e) && this.right !== null && this.right.search(e, r));
    }
    searchAfter(e, r) {
      this.low >= e && (r.push(this), this.left !== null && this.left.searchAfter(e, r)), this.right !== null && this.right.searchAfter(e, r);
    }
    traverse(e) {
      e(this), this.left !== null && this.left.traverse(e), this.right !== null && this.right.traverse(e);
    }
    updateHeight() {
      this.left !== null && this.right !== null ? this.height = Math.max(this.left.height, this.right.height) + 1 : this.right !== null ? this.height = this.right.height + 1 : this.left !== null ? this.height = this.left.height + 1 : this.height = 0;
    }
    updateMax() {
      this.max = this.high, this.left !== null && (this.max = Math.max(this.max, this.left.max)), this.right !== null && (this.max = Math.max(this.max, this.right.max));
    }
    getBalance() {
      let e = 0;
      return this.left !== null && this.right !== null ? e = this.left.height - this.right.height : this.left !== null ? e = this.left.height + 1 : this.right !== null && (e = -(this.right.height + 1)), e;
    }
    isLeftChild() {
      return this.parent !== null && this.parent.left === this;
    }
    get left() {
      return this._left;
    }
    set left(e) {
      this._left = e, e !== null && (e.parent = this), this.updateHeight(), this.updateMax();
    }
    get right() {
      return this._right;
    }
    set right(e) {
      this._right = e, e !== null && (e.parent = this), this.updateHeight(), this.updateMax();
    }
    dispose() {
      this.parent = null, this._left = null, this._right = null, this.event = null;
    }
  };
  var Wl = class extends $e {
    constructor(e) {
      super(), this.name = "TimelineValue", this._timeline = new je({ memory: 10 }), this._initialValue = e;
    }
    set(e, r) {
      return this._timeline.add({ value: e, time: r }), this;
    }
    get(e) {
      let r = this._timeline.get(e);
      return r ? r.value : this._initialValue;
    }
  };
  var St = class t extends V {
    constructor() {
      super(O(t.getDefaults(), arguments, ["context"]));
    }
    connect(e, r = 0, n = 0) {
      return ms(this, e, r, n), this;
    }
  };
  var Wt = class t extends St {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["mapping", "length"]);
      super(e), this.name = "WaveShaper", this._shaper = this.context.createWaveShaper(), this.input = this._shaper, this.output = this._shaper, Pe(e.mapping) || e.mapping instanceof Float32Array ? this.curve = Float32Array.from(e.mapping) : tv(e.mapping) && this.setMap(e.mapping, e.length);
    }
    static getDefaults() {
      return Object.assign(J.getDefaults(), { length: 1024 });
    }
    setMap(e, r = 1024) {
      let n = new Float32Array(r);
      for (let o = 0, s = r; o < s; o++) {
        let i = o / (s - 1) * 2 - 1;
        n[o] = e(i, o);
      }
      return this.curve = n, this;
    }
    get curve() {
      return this._shaper.curve;
    }
    set curve(e) {
      this._shaper.curve = e;
    }
    get oversample() {
      return this._shaper.oversample;
    }
    set oversample(e) {
      let r = ["none", "2x", "4x"].some((n) => n.includes(e));
      Q(r, "oversampling must be either 'none', '2x', or '4x'"), this._shaper.oversample = e;
    }
    dispose() {
      return super.dispose(), this._shaper.disconnect(), this;
    }
  };
  var xs = class t extends St {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["value"]);
      super(e), this.name = "Pow", this._exponentScaler = this.input = this.output = new Wt({ context: this.context, mapping: this._expFunc(e.value), length: 8192 }), this._exponent = e.value;
    }
    static getDefaults() {
      return Object.assign(St.getDefaults(), { value: 1 });
    }
    _expFunc(e) {
      return (r) => Math.pow(Math.abs(r), e);
    }
    get value() {
      return this._exponent;
    }
    set value(e) {
      this._exponent = e, this._exponentScaler.setMap(this._expFunc(this._exponent));
    }
    dispose() {
      return super.dispose(), this._exponentScaler.dispose(), this;
    }
  };
  var Jr = class t {
    constructor(e, r) {
      this.id = t._eventId++, this._remainderTime = 0;
      let n = Object.assign(t.getDefaults(), r);
      this.transport = e, this.callback = n.callback, this._once = n.once, this.time = Math.floor(n.time), this._remainderTime = n.time - this.time;
    }
    static getDefaults() {
      return { callback: Z, once: false, time: 0 };
    }
    get floatTime() {
      return this.time + this._remainderTime;
    }
    invoke(e) {
      if (this.callback) {
        let r = this.transport.bpm.getDurationOfTicks(1, e);
        this.callback(e + this._remainderTime * r), this._once && this.transport.clear(this.id);
      }
    }
    dispose() {
      return this.callback = void 0, this;
    }
  };
  Jr._eventId = 0;
  var Bl = class t extends Jr {
    constructor(e, r) {
      super(e, r), this._currentId = -1, this._nextId = -1, this._nextTick = this.time, this._boundRestart = this._restart.bind(this);
      let n = Object.assign(t.getDefaults(), r);
      this.duration = n.duration, this._interval = n.interval, this._nextTick = n.time, this.transport.on("start", this._boundRestart), this.transport.on("loopStart", this._boundRestart), this.transport.on("ticks", this._boundRestart), this.context = this.transport.context, this._restart();
    }
    static getDefaults() {
      return Object.assign({}, Jr.getDefaults(), { duration: 1 / 0, interval: 1, once: false });
    }
    invoke(e) {
      this._createEvents(e), super.invoke(e);
    }
    _createEvent() {
      return oo(this._nextTick, this.floatTime + this.duration) ? this.transport.scheduleOnce(this.invoke.bind(this), new zt(this.context, this._nextTick).toSeconds()) : -1;
    }
    _createEvents(e) {
      oo(this._nextTick + this._interval, this.floatTime + this.duration) && (this._nextTick += this._interval, this._currentId = this._nextId, this._nextId = this.transport.scheduleOnce(this.invoke.bind(this), new zt(this.context, this._nextTick).toSeconds()));
    }
    _restart(e) {
      this.transport.clear(this._currentId), this.transport.clear(this._nextId), this._nextTick = this.floatTime;
      let r = this.transport.getTicksAtTime(e);
      Kr(r, this.time) && (this._nextTick = this.floatTime + Math.ceil((r - this.floatTime) / this._interval) * this._interval), this._currentId = this._createEvent(), this._nextTick += this._interval, this._nextId = this._createEvent();
    }
    dispose() {
      return super.dispose(), this.transport.clear(this._currentId), this.transport.clear(this._nextId), this.transport.off("start", this._boundRestart), this.transport.off("loopStart", this._boundRestart), this.transport.off("ticks", this._boundRestart), this;
    }
  };
  var Ul = class t extends ze {
    constructor() {
      let e = O(t.getDefaults(), arguments);
      super(e), this.name = "Transport", this._loop = new Wl(false), this._loopStart = 0, this._loopEnd = 0, this._scheduledEvents = {}, this._timeline = new je(), this._repeatedEvents = new zl(), this._syncedSignals = [], this._swingAmount = 0, this._ppq = e.ppq, this._clock = new gs({ callback: this._processTick.bind(this), context: this.context, frequency: 0, units: "bpm" }), this._bindClockEvents(), this.bpm = this._clock.frequency, this._clock.frequency.multiplier = e.ppq, this.bpm.setValueAtTime(e.bpm, 0), z(this, "bpm"), this._timeSignature = e.timeSignature, this._swingTicks = e.ppq / 2;
    }
    static getDefaults() {
      return Object.assign(ze.getDefaults(), { bpm: 120, loopEnd: "4m", loopStart: 0, ppq: 192, swing: 0, swingSubdivision: "8n", timeSignature: 4 });
    }
    _processTick(e, r) {
      if (this._loop.get(e) && r >= this._loopEnd && (this.emit("loopEnd", e), this._clock.setTicksAtTime(this._loopStart, e), r = this._loopStart, this.emit("loopStart", e, this._clock.getSecondsAtTime(e)), this.emit("loop", e)), this._swingAmount > 0 && r % this._ppq !== 0 && r % (this._swingTicks * 2) !== 0) {
        let n = r % (this._swingTicks * 2) / (this._swingTicks * 2), o = Math.sin(n * Math.PI) * this._swingAmount;
        e += new zt(this.context, this._swingTicks * 2 / 3).toSeconds() * o;
      }
      np(true), this._timeline.forEachAtTime(r, (n) => n.invoke(e)), np(false);
    }
    schedule(e, r) {
      let n = new Jr(this, { callback: e, time: new nr(this.context, r).toTicks() });
      return this._addEvent(n, this._timeline);
    }
    scheduleRepeat(e, r, n, o = 1 / 0) {
      let s = new Bl(this, { callback: e, duration: new jt(this.context, o).toTicks(), interval: new jt(this.context, r).toTicks(), time: new nr(this.context, n).toTicks() });
      return this._addEvent(s, this._repeatedEvents);
    }
    scheduleOnce(e, r) {
      let n = new Jr(this, { callback: e, once: true, time: new nr(this.context, r).toTicks() });
      return this._addEvent(n, this._timeline);
    }
    clear(e) {
      if (this._scheduledEvents.hasOwnProperty(e)) {
        let r = this._scheduledEvents[e.toString()];
        r.timeline.remove(r.event), r.event.dispose(), delete this._scheduledEvents[e.toString()];
      }
      return this;
    }
    _addEvent(e, r) {
      return this._scheduledEvents[e.id.toString()] = { event: e, timeline: r }, r.add(e), e.id;
    }
    cancel(e = 0) {
      let r = this.toTicks(e);
      return this._timeline.forEachFrom(r, (n) => this.clear(n.id)), this._repeatedEvents.forEachFrom(r, (n) => this.clear(n.id)), this;
    }
    _bindClockEvents() {
      this._clock.on("start", (e, r) => {
        r = new zt(this.context, r).toSeconds(), this.emit("start", e, r);
      }), this._clock.on("stop", (e) => {
        this.emit("stop", e);
      }), this._clock.on("pause", (e) => {
        this.emit("pause", e);
      });
    }
    get state() {
      return this._clock.getStateAtTime(this.now());
    }
    start(e, r) {
      this.context.resume();
      let n;
      return X(r) && (n = this.toTicks(r)), this._clock.start(e, n), this;
    }
    stop(e) {
      return this._clock.stop(e), this;
    }
    pause(e) {
      return this._clock.pause(e), this;
    }
    toggle(e) {
      return e = this.toSeconds(e), this._clock.getStateAtTime(e) !== "started" ? this.start(e) : this.stop(e), this;
    }
    get timeSignature() {
      return this._timeSignature;
    }
    set timeSignature(e) {
      Pe(e) && (e = e[0] / e[1] * 4), this._timeSignature = e;
    }
    get loopStart() {
      return new jt(this.context, this._loopStart, "i").toSeconds();
    }
    set loopStart(e) {
      this._loopStart = this.toTicks(e);
    }
    get loopEnd() {
      return new jt(this.context, this._loopEnd, "i").toSeconds();
    }
    set loopEnd(e) {
      this._loopEnd = this.toTicks(e);
    }
    get loop() {
      return this._loop.get(this.now());
    }
    set loop(e) {
      this._loop.set(e, this.now());
    }
    setLoopPoints(e, r) {
      return this.loopStart = e, this.loopEnd = r, this;
    }
    get swing() {
      return this._swingAmount;
    }
    set swing(e) {
      this._swingAmount = e;
    }
    get swingSubdivision() {
      return new zt(this.context, this._swingTicks).toNotation();
    }
    set swingSubdivision(e) {
      this._swingTicks = this.toTicks(e);
    }
    get position() {
      let e = this.now(), r = this._clock.getTicksAtTime(e);
      return new zt(this.context, r).toBarsBeatsSixteenths();
    }
    set position(e) {
      let r = this.toTicks(e);
      this.ticks = r;
    }
    get seconds() {
      return this._clock.seconds;
    }
    set seconds(e) {
      let r = this.now(), n = this._clock.frequency.timeToTicks(e, r);
      this.ticks = n;
    }
    get progress() {
      if (this.loop) {
        let e = this.now();
        return (this._clock.getTicksAtTime(e) - this._loopStart) / (this._loopEnd - this._loopStart);
      } else return 0;
    }
    get ticks() {
      return this._clock.ticks;
    }
    set ticks(e) {
      if (this._clock.ticks !== e) {
        let r = this.now();
        if (this.state === "started") {
          let n = this._clock.getTicksAtTime(r), o = this._clock.frequency.getDurationOfTicks(Math.ceil(n) - n, r), s = r + o;
          this.emit("stop", s), this._clock.setTicksAtTime(e, s), this.emit("start", s, this._clock.getSecondsAtTime(s));
        } else this.emit("ticks", r), this._clock.setTicksAtTime(e, r);
      }
    }
    getTicksAtTime(e) {
      return this._clock.getTicksAtTime(e);
    }
    getSecondsAtTime(e) {
      return this._clock.getSecondsAtTime(e);
    }
    get PPQ() {
      return this._clock.frequency.multiplier;
    }
    set PPQ(e) {
      this._clock.frequency.multiplier = e;
    }
    nextSubdivision(e) {
      if (e = this.toTicks(e), this.state !== "started") return 0;
      {
        let r = this.now(), n = this.getTicksAtTime(r), o = e - n % e;
        return this._clock.nextTickTime(o, r);
      }
    }
    syncSignal(e, r) {
      let n = this.now(), o = this.bpm, s = 1 / (60 / o.getValueAtTime(n) / this.PPQ), i = [];
      if (e.units === "time") {
        let l = 0.015625 / s, u = new H(l), c = new xs(-1), h = new H(l);
        o.chain(u, c, h), o = h, s = 1 / s, i = [u, c, h];
      }
      r || (e.getValueAtTime(n) !== 0 ? r = e.getValueAtTime(n) / s : r = 0);
      let a = new H(r);
      return o.connect(a), a.connect(e._param), i.push(a), this._syncedSignals.push({ initial: e.value, nodes: i, signal: e }), e.value = 0, this;
    }
    unsyncSignal(e) {
      for (let r = this._syncedSignals.length - 1; r >= 0; r--) {
        let n = this._syncedSignals[r];
        n.signal === e && (n.nodes.forEach((o) => o.dispose()), n.signal.value = n.initial, this._syncedSignals.splice(r, 1));
      }
      return this;
    }
    dispose() {
      return super.dispose(), this._clock.dispose(), ps(this, "bpm"), this._timeline.dispose(), this._repeatedEvents.dispose(), this;
    }
  };
  Vn.mixin(Ul);
  In((t) => {
    t.transport = new Ul({ context: t });
  });
  Pn((t) => {
    t.transport.dispose();
  });
  var pe = class extends V {
    constructor(e) {
      super(e), this.input = void 0, this._state = new Lr("stopped"), this._synced = false, this._scheduled = [], this._syncedStart = Z, this._syncedStop = Z, this._state.memory = 100, this._state.increasing = true, this._volume = this.output = new or({ context: this.context, mute: e.mute, volume: e.volume }), this.volume = this._volume.volume, z(this, "volume"), this.onstop = e.onstop;
    }
    static getDefaults() {
      return Object.assign(V.getDefaults(), { mute: false, onstop: Z, volume: 0 });
    }
    get state() {
      return this._synced ? this.context.transport.state === "started" ? this._state.getValueAtTime(this.context.transport.seconds) : "stopped" : this._state.getValueAtTime(this.now());
    }
    get mute() {
      return this._volume.mute;
    }
    set mute(e) {
      this._volume.mute = e;
    }
    _clampToCurrentTime(e) {
      return this._synced ? e : Math.max(e, this.context.currentTime);
    }
    start(e, r, n) {
      let o = Ie(e) && this._synced ? this.context.transport.seconds : this.toSeconds(e);
      if (o = this._clampToCurrentTime(o), !this._synced && this._state.getValueAtTime(o) === "started") Q(Kr(o, this._state.get(o).time), "Start time must be strictly greater than previous start time"), this._state.cancel(o), this._state.setStateAtTime("started", o), this.log("restart", o), this.restart(o, r, n);
      else if (this.log("start", o), this._state.setStateAtTime("started", o), this._synced) {
        let s = this._state.get(o);
        s && (s.offset = this.toSeconds(qt(r, 0)), s.duration = n ? this.toSeconds(n) : void 0);
        let i = this.context.transport.schedule((a) => {
          this._start(a, r, n);
        }, o);
        this._scheduled.push(i), this.context.transport.state === "started" && this.context.transport.getSecondsAtTime(this.immediate()) > o && this._syncedStart(this.now(), this.context.transport.seconds);
      } else Ml(this.context), this._start(o, r, n);
      return this;
    }
    stop(e) {
      let r = Ie(e) && this._synced ? this.context.transport.seconds : this.toSeconds(e);
      if (r = this._clampToCurrentTime(r), this._state.getValueAtTime(r) === "started" || X(this._state.getNextState("started", r))) {
        if (this.log("stop", r), !this._synced) this._stop(r);
        else {
          let n = this.context.transport.schedule(this._stop.bind(this), r);
          this._scheduled.push(n);
        }
        this._state.cancel(r), this._state.setStateAtTime("stopped", r);
      }
      return this;
    }
    restart(e, r, n) {
      return e = this.toSeconds(e), this._state.getValueAtTime(e) === "started" && (this._state.cancel(e), this._restart(e, r, n)), this;
    }
    sync() {
      return this._synced || (this._synced = true, this._syncedStart = (e, r) => {
        if (Kr(r, 0)) {
          let n = this._state.get(r);
          if (n && n.state === "started" && n.time !== r) {
            let o = r - this.toSeconds(n.time), s;
            n.duration && (s = this.toSeconds(n.duration) - o), this._start(e, this.toSeconds(n.offset) + o, s);
          }
        }
      }, this._syncedStop = (e) => {
        let r = this.context.transport.getSecondsAtTime(Math.max(e - this.sampleTime, 0));
        this._state.getValueAtTime(r) === "started" && this._stop(e);
      }, this.context.transport.on("start", this._syncedStart), this.context.transport.on("loopStart", this._syncedStart), this.context.transport.on("stop", this._syncedStop), this.context.transport.on("pause", this._syncedStop), this.context.transport.on("loopEnd", this._syncedStop)), this;
    }
    unsync() {
      return this._synced && (this.context.transport.off("stop", this._syncedStop), this.context.transport.off("pause", this._syncedStop), this.context.transport.off("loopEnd", this._syncedStop), this.context.transport.off("start", this._syncedStart), this.context.transport.off("loopStart", this._syncedStart)), this._synced = false, this._scheduled.forEach((e) => this.context.transport.clear(e)), this._scheduled = [], this._state.cancel(0), this._stop(0), this;
    }
    dispose() {
      return super.dispose(), this.onstop = Z, this.unsync(), this._volume.dispose(), this._state.dispose(), this;
    }
  };
  var en = class t extends wr {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["url", "onload"]);
      super(e), this.name = "ToneBufferSource", this._source = this.context.createBufferSource(), this._internalChannels = [this._source], this._sourceStarted = false, this._sourceStopped = false, wt(this._source, this._gainNode), this._source.onended = () => this._stopSource(), this.playbackRate = new te({ context: this.context, param: this._source.playbackRate, units: "positive", value: e.playbackRate }), this.loop = e.loop, this.loopStart = e.loopStart, this.loopEnd = e.loopEnd, this._buffer = new Ye(e.url, e.onload, e.onerror), this._internalChannels.push(this._source);
    }
    static getDefaults() {
      return Object.assign(wr.getDefaults(), { url: new Ye(), loop: false, loopEnd: 0, loopStart: 0, onload: Z, onerror: Z, playbackRate: 1 });
    }
    get fadeIn() {
      return this._fadeIn;
    }
    set fadeIn(e) {
      this._fadeIn = e;
    }
    get fadeOut() {
      return this._fadeOut;
    }
    set fadeOut(e) {
      this._fadeOut = e;
    }
    get curve() {
      return this._curve;
    }
    set curve(e) {
      this._curve = e;
    }
    start(e, r, n, o = 1) {
      Q(this.buffer.loaded, "buffer is either not set or not loaded");
      let s = this.toSeconds(e);
      this._startGain(s, o), this.loop ? r = qt(r, this.loopStart) : r = qt(r, 0);
      let i = Math.max(this.toSeconds(r), 0);
      if (this.loop) {
        let a = this.toSeconds(this.loopEnd) || this.buffer.duration, l = this.toSeconds(this.loopStart), u = a - l;
        Pi(i, a) && (i = (i - l) % u + l), vt(i, this.buffer.duration) && (i = 0);
      }
      if (this._source.buffer = this.buffer.get(), this._source.loopEnd = this.toSeconds(this.loopEnd) || this.buffer.duration, oo(i, this.buffer.duration) && (this._sourceStarted = true, this._source.start(s, i)), X(n)) {
        let a = this.toSeconds(n);
        a = Math.max(a, 0), this.stop(s + a);
      }
      return this;
    }
    _stopSource(e) {
      !this._sourceStopped && this._sourceStarted && (this._sourceStopped = true, this._source.stop(this.toSeconds(e)), this._onended());
    }
    get loopStart() {
      return this._source.loopStart;
    }
    set loopStart(e) {
      this._source.loopStart = this.toSeconds(e);
    }
    get loopEnd() {
      return this._source.loopEnd;
    }
    set loopEnd(e) {
      this._source.loopEnd = this.toSeconds(e);
    }
    get buffer() {
      return this._buffer;
    }
    set buffer(e) {
      this._buffer.set(e);
    }
    get loop() {
      return this._source.loop;
    }
    set loop(e) {
      this._source.loop = e, this._sourceStarted && this.cancelStop();
    }
    dispose() {
      return super.dispose(), this._source.onended = null, this._source.disconnect(), this._buffer.dispose(), this.playbackRate.dispose(), this;
    }
  };
  var jG = 44100 * 5;
  function Dt(t, e) {
    return oe(this, void 0, void 0, function* () {
      let r = e / t.context.sampleRate, n = new Vr(1, r, t.context.sampleRate);
      return new t.constructor(Object.assign(t.get(), { frequency: 2 / r, detune: 0, context: n })).toDestination().start(0), (yield n.render()).getChannelData(0);
    });
  }
  var Li = class t extends wr {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["frequency", "type"]);
      super(e), this.name = "ToneOscillatorNode", this._oscillator = this.context.createOscillator(), this._internalChannels = [this._oscillator], wt(this._oscillator, this._gainNode), this.type = e.type, this.frequency = new te({ context: this.context, param: this._oscillator.frequency, units: "frequency", value: e.frequency }), this.detune = new te({ context: this.context, param: this._oscillator.detune, units: "cents", value: e.detune }), z(this, ["frequency", "detune"]);
    }
    static getDefaults() {
      return Object.assign(wr.getDefaults(), { detune: 0, frequency: 440, type: "sine" });
    }
    start(e) {
      let r = this.toSeconds(e);
      return this.log("start", r), this._startGain(r), this._oscillator.start(r), this;
    }
    _stopSource(e) {
      this._oscillator.stop(e);
    }
    setPeriodicWave(e) {
      return this._oscillator.setPeriodicWave(e), this;
    }
    get type() {
      return this._oscillator.type;
    }
    set type(e) {
      this._oscillator.type = e;
    }
    dispose() {
      return super.dispose(), this.state === "started" && this.stop(), this._oscillator.disconnect(), this.frequency.dispose(), this.detune.dispose(), this;
    }
  };
  var Oe = class t extends pe {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["frequency", "type"]);
      super(e), this.name = "Oscillator", this._oscillator = null, this.frequency = new J({ context: this.context, units: "frequency", value: e.frequency }), z(this, "frequency"), this.detune = new J({ context: this.context, units: "cents", value: e.detune }), z(this, "detune"), this._partials = e.partials, this._partialCount = e.partialCount, this._type = e.type, e.partialCount && e.type !== "custom" && (this._type = this.baseType + e.partialCount.toString()), this.phase = e.phase;
    }
    static getDefaults() {
      return Object.assign(pe.getDefaults(), { detune: 0, frequency: 440, partialCount: 0, partials: [], phase: 0, type: "sine" });
    }
    _start(e) {
      let r = this.toSeconds(e), n = new Li({ context: this.context, onended: () => this.onstop(this) });
      this._oscillator = n, this._wave ? this._oscillator.setPeriodicWave(this._wave) : this._oscillator.type = this._type, this._oscillator.connect(this.output), this.frequency.connect(this._oscillator.frequency), this.detune.connect(this._oscillator.detune), this._oscillator.start(r);
    }
    _stop(e) {
      let r = this.toSeconds(e);
      this._oscillator && this._oscillator.stop(r);
    }
    _restart(e) {
      let r = this.toSeconds(e);
      return this.log("restart", r), this._oscillator && this._oscillator.cancelStop(), this._state.cancel(r), this;
    }
    syncFrequency() {
      return this.context.transport.syncSignal(this.frequency), this;
    }
    unsyncFrequency() {
      return this.context.transport.unsyncSignal(this.frequency), this;
    }
    _getCachedPeriodicWave() {
      if (this._type === "custom") return t._periodicWaveCache.find((r) => r.phase === this._phase && pv(r.partials, this._partials));
      {
        let e = t._periodicWaveCache.find((r) => r.type === this._type && r.phase === this._phase);
        return this._partialCount = e ? e.partialCount : this._partialCount, e;
      }
    }
    get type() {
      return this._type;
    }
    set type(e) {
      this._type = e;
      let r = ["sine", "square", "sawtooth", "triangle"].indexOf(e) !== -1;
      if (this._phase === 0 && r) this._wave = void 0, this._partialCount = 0, this._oscillator !== null && (this._oscillator.type = e);
      else {
        let n = this._getCachedPeriodicWave();
        if (X(n)) {
          let { partials: o, wave: s } = n;
          this._wave = s, this._partials = o, this._oscillator !== null && this._oscillator.setPeriodicWave(this._wave);
        } else {
          let [o, s] = this._getRealImaginary(e, this._phase), i = this.context.createPeriodicWave(o, s);
          this._wave = i, this._oscillator !== null && this._oscillator.setPeriodicWave(this._wave), t._periodicWaveCache.push({ imag: s, partialCount: this._partialCount, partials: this._partials, phase: this._phase, real: o, type: this._type, wave: this._wave }), t._periodicWaveCache.length > 100 && t._periodicWaveCache.shift();
        }
      }
    }
    get baseType() {
      return this._type.replace(this.partialCount.toString(), "");
    }
    set baseType(e) {
      this.partialCount && this._type !== "custom" && e !== "custom" ? this.type = e + this.partialCount : this.type = e;
    }
    get partialCount() {
      return this._partialCount;
    }
    set partialCount(e) {
      Ke(e, 0);
      let r = this._type, n = /^(sine|triangle|square|sawtooth)(\d+)$/.exec(this._type);
      if (n && (r = n[1]), this._type !== "custom") e === 0 ? this.type = r : this.type = r + e.toString();
      else {
        let o = new Float32Array(e);
        this._partials.forEach((s, i) => o[i] = s), this._partials = Array.from(o), this.type = this._type;
      }
    }
    _getRealImaginary(e, r) {
      let o = 2048, s = new Float32Array(o), i = new Float32Array(o), a = 1;
      if (e === "custom") {
        if (a = this._partials.length + 1, this._partialCount = this._partials.length, o = a, this._partials.length === 0) return [s, i];
      } else {
        let l = /^(sine|triangle|square|sawtooth)(\d+)$/.exec(e);
        l ? (a = parseInt(l[2], 10) + 1, this._partialCount = parseInt(l[2], 10), e = l[1], a = Math.max(a, 2), o = a) : this._partialCount = 0, this._partials = [];
      }
      for (let l = 1; l < o; ++l) {
        let u = 2 / (l * Math.PI), c;
        switch (e) {
          case "sine":
            c = l <= a ? 1 : 0, this._partials[l - 1] = c;
            break;
          case "square":
            c = l & 1 ? 2 * u : 0, this._partials[l - 1] = c;
            break;
          case "sawtooth":
            c = u * (l & 1 ? 1 : -1), this._partials[l - 1] = c;
            break;
          case "triangle":
            l & 1 ? c = 2 * (u * u) * (l - 1 >> 1 & 1 ? -1 : 1) : c = 0, this._partials[l - 1] = c;
            break;
          case "custom":
            c = this._partials[l - 1];
            break;
          default:
            throw new TypeError("Oscillator: invalid type: " + e);
        }
        c !== 0 ? (s[l] = -c * Math.sin(r * l), i[l] = c * Math.cos(r * l)) : (s[l] = 0, i[l] = 0);
      }
      return [s, i];
    }
    _inverseFFT(e, r, n) {
      let o = 0, s = e.length;
      for (let i = 0; i < s; i++) o += e[i] * Math.cos(i * n) + r[i] * Math.sin(i * n);
      return o;
    }
    getInitialValue() {
      let [e, r] = this._getRealImaginary(this._type, 0), n = 0, o = Math.PI * 2, s = 32;
      for (let i = 0; i < s; i++) n = Math.max(this._inverseFFT(e, r, i / s * o), n);
      return op(-this._inverseFFT(e, r, this._phase) / n, -1, 1);
    }
    get partials() {
      return this._partials.slice(0, this.partialCount);
    }
    set partials(e) {
      this._partials = e, this._partialCount = this._partials.length, e.length && (this.type = "custom");
    }
    get phase() {
      return this._phase * (180 / Math.PI);
    }
    set phase(e) {
      this._phase = e * Math.PI / 180, this.type = this._type;
    }
    asArray() {
      return oe(this, arguments, void 0, function* (e = 1024) {
        return Dt(this, e);
      });
    }
    dispose() {
      return super.dispose(), this._oscillator !== null && this._oscillator.dispose(), this._wave = void 0, this.frequency.dispose(), this.detune.dispose(), this;
    }
  };
  Oe._periodicWaveCache = [];
  var ys = class extends St {
    constructor() {
      super(...arguments), this.name = "AudioToGain", this._norm = new Wt({ context: this.context, mapping: (e) => (e + 1) / 2 }), this.input = this._norm, this.output = this._norm;
    }
    dispose() {
      return super.dispose(), this._norm.dispose(), this;
    }
  };
  var We = class t extends J {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["value"]);
      super(e), this.name = "Multiply", this.override = false, this._mult = this.input = this.output = new H({ context: this.context, minValue: e.minValue, maxValue: e.maxValue }), this.factor = this._param = this._mult.gain, this.factor.setValueAtTime(e.value, 0);
    }
    static getDefaults() {
      return Object.assign(J.getDefaults(), { value: 0 });
    }
    dispose() {
      return super.dispose(), this._mult.dispose(), this;
    }
  };
  var qi = class t extends pe {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["frequency", "type", "modulationType"]);
      super(e), this.name = "AMOscillator", this._modulationScale = new ys({ context: this.context }), this._modulationNode = new H({ context: this.context }), this._carrier = new Oe({ context: this.context, detune: e.detune, frequency: e.frequency, onstop: () => this.onstop(this), phase: e.phase, type: e.type }), this.frequency = this._carrier.frequency, this.detune = this._carrier.detune, this._modulator = new Oe({ context: this.context, phase: e.phase, type: e.modulationType }), this.harmonicity = new We({ context: this.context, units: "positive", value: e.harmonicity }), this.frequency.chain(this.harmonicity, this._modulator.frequency), this._modulator.chain(this._modulationScale, this._modulationNode.gain), this._carrier.chain(this._modulationNode, this.output), z(this, ["frequency", "detune", "harmonicity"]);
    }
    static getDefaults() {
      return Object.assign(Oe.getDefaults(), { harmonicity: 1, modulationType: "square" });
    }
    _start(e) {
      this._modulator.start(e), this._carrier.start(e);
    }
    _stop(e) {
      this._modulator.stop(e), this._carrier.stop(e);
    }
    _restart(e) {
      this._modulator.restart(e), this._carrier.restart(e);
    }
    get type() {
      return this._carrier.type;
    }
    set type(e) {
      this._carrier.type = e;
    }
    get baseType() {
      return this._carrier.baseType;
    }
    set baseType(e) {
      this._carrier.baseType = e;
    }
    get partialCount() {
      return this._carrier.partialCount;
    }
    set partialCount(e) {
      this._carrier.partialCount = e;
    }
    get modulationType() {
      return this._modulator.type;
    }
    set modulationType(e) {
      this._modulator.type = e;
    }
    get phase() {
      return this._carrier.phase;
    }
    set phase(e) {
      this._carrier.phase = e, this._modulator.phase = e;
    }
    get partials() {
      return this._carrier.partials;
    }
    set partials(e) {
      this._carrier.partials = e;
    }
    asArray() {
      return oe(this, arguments, void 0, function* (e = 1024) {
        return Dt(this, e);
      });
    }
    dispose() {
      return super.dispose(), this.frequency.dispose(), this.detune.dispose(), this.harmonicity.dispose(), this._carrier.dispose(), this._modulator.dispose(), this._modulationNode.dispose(), this._modulationScale.dispose(), this;
    }
  };
  var vs = class t extends pe {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["frequency", "type", "modulationType"]);
      super(e), this.name = "FMOscillator", this._modulationNode = new H({ context: this.context, gain: 0 }), this._carrier = new Oe({ context: this.context, detune: e.detune, frequency: 0, onstop: () => this.onstop(this), phase: e.phase, type: e.type }), this.detune = this._carrier.detune, this.frequency = new J({ context: this.context, units: "frequency", value: e.frequency }), this._modulator = new Oe({ context: this.context, phase: e.phase, type: e.modulationType }), this.harmonicity = new We({ context: this.context, units: "positive", value: e.harmonicity }), this.modulationIndex = new We({ context: this.context, units: "positive", value: e.modulationIndex }), this.frequency.connect(this._carrier.frequency), this.frequency.chain(this.harmonicity, this._modulator.frequency), this.frequency.chain(this.modulationIndex, this._modulationNode), this._modulator.connect(this._modulationNode.gain), this._modulationNode.connect(this._carrier.frequency), this._carrier.connect(this.output), this.detune.connect(this._modulator.detune), z(this, ["modulationIndex", "frequency", "detune", "harmonicity"]);
    }
    static getDefaults() {
      return Object.assign(Oe.getDefaults(), { harmonicity: 1, modulationIndex: 2, modulationType: "square" });
    }
    _start(e) {
      this._modulator.start(e), this._carrier.start(e);
    }
    _stop(e) {
      this._modulator.stop(e), this._carrier.stop(e);
    }
    _restart(e) {
      return this._modulator.restart(e), this._carrier.restart(e), this;
    }
    get type() {
      return this._carrier.type;
    }
    set type(e) {
      this._carrier.type = e;
    }
    get baseType() {
      return this._carrier.baseType;
    }
    set baseType(e) {
      this._carrier.baseType = e;
    }
    get partialCount() {
      return this._carrier.partialCount;
    }
    set partialCount(e) {
      this._carrier.partialCount = e;
    }
    get modulationType() {
      return this._modulator.type;
    }
    set modulationType(e) {
      this._modulator.type = e;
    }
    get phase() {
      return this._carrier.phase;
    }
    set phase(e) {
      this._carrier.phase = e, this._modulator.phase = e;
    }
    get partials() {
      return this._carrier.partials;
    }
    set partials(e) {
      this._carrier.partials = e;
    }
    asArray() {
      return oe(this, arguments, void 0, function* (e = 1024) {
        return Dt(this, e);
      });
    }
    dispose() {
      return super.dispose(), this.frequency.dispose(), this.harmonicity.dispose(), this._carrier.dispose(), this._modulator.dispose(), this._modulationNode.dispose(), this.modulationIndex.dispose(), this;
    }
  };
  var uo = class t extends pe {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["frequency", "width"]);
      super(e), this.name = "PulseOscillator", this._widthGate = new H({ context: this.context, gain: 0 }), this._thresh = new Wt({ context: this.context, mapping: (r) => r <= 0 ? -1 : 1 }), this.width = new J({ context: this.context, units: "audioRange", value: e.width }), this._triangle = new Oe({ context: this.context, detune: e.detune, frequency: e.frequency, onstop: () => this.onstop(this), phase: e.phase, type: "triangle" }), this.frequency = this._triangle.frequency, this.detune = this._triangle.detune, this._triangle.chain(this._thresh, this.output), this.width.chain(this._widthGate, this._thresh), z(this, ["width", "frequency", "detune"]);
    }
    static getDefaults() {
      return Object.assign(pe.getDefaults(), { detune: 0, frequency: 440, phase: 0, type: "pulse", width: 0.2 });
    }
    _start(e) {
      e = this.toSeconds(e), this._triangle.start(e), this._widthGate.gain.setValueAtTime(1, e);
    }
    _stop(e) {
      e = this.toSeconds(e), this._triangle.stop(e), this._widthGate.gain.cancelScheduledValues(e), this._widthGate.gain.setValueAtTime(0, e);
    }
    _restart(e) {
      this._triangle.restart(e), this._widthGate.gain.cancelScheduledValues(e), this._widthGate.gain.setValueAtTime(1, e);
    }
    get phase() {
      return this._triangle.phase;
    }
    set phase(e) {
      this._triangle.phase = e;
    }
    get type() {
      return "pulse";
    }
    get baseType() {
      return "pulse";
    }
    get partials() {
      return [];
    }
    get partialCount() {
      return 0;
    }
    set carrierType(e) {
      this._triangle.type = e;
    }
    asArray() {
      return oe(this, arguments, void 0, function* (e = 1024) {
        return Dt(this, e);
      });
    }
    dispose() {
      return super.dispose(), this._triangle.dispose(), this.width.dispose(), this._widthGate.dispose(), this._thresh.dispose(), this;
    }
  };
  var ji = class t extends pe {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["frequency", "type", "spread"]);
      super(e), this.name = "FatOscillator", this._oscillators = [], this.frequency = new J({ context: this.context, units: "frequency", value: e.frequency }), this.detune = new J({ context: this.context, units: "cents", value: e.detune }), this._spread = e.spread, this._type = e.type, this._phase = e.phase, this._partials = e.partials, this._partialCount = e.partialCount, this.count = e.count, z(this, ["frequency", "detune"]);
    }
    static getDefaults() {
      return Object.assign(Oe.getDefaults(), { count: 3, spread: 20, type: "sawtooth" });
    }
    _start(e) {
      e = this.toSeconds(e), this._forEach((r) => r.start(e));
    }
    _stop(e) {
      e = this.toSeconds(e), this._forEach((r) => r.stop(e));
    }
    _restart(e) {
      this._forEach((r) => r.restart(e));
    }
    _forEach(e) {
      for (let r = 0; r < this._oscillators.length; r++) e(this._oscillators[r], r);
    }
    get type() {
      return this._type;
    }
    set type(e) {
      this._type = e, this._forEach((r) => r.type = e);
    }
    get spread() {
      return this._spread;
    }
    set spread(e) {
      if (this._spread = e, this._oscillators.length > 1) {
        let r = -e / 2, n = e / (this._oscillators.length - 1);
        this._forEach((o, s) => o.detune.value = r + n * s);
      }
    }
    get count() {
      return this._oscillators.length;
    }
    set count(e) {
      if (Ke(e, 1), this._oscillators.length !== e) {
        this._forEach((r) => r.dispose()), this._oscillators = [];
        for (let r = 0; r < e; r++) {
          let n = new Oe({ context: this.context, volume: -6 - e * 1.1, type: this._type, phase: this._phase + r / e * 360, partialCount: this._partialCount, onstop: r === 0 ? () => this.onstop(this) : Z });
          this.type === "custom" && (n.partials = this._partials), this.frequency.connect(n.frequency), this.detune.connect(n.detune), n.detune.overridden = false, n.connect(this.output), this._oscillators[r] = n;
        }
        this.spread = this._spread, this.state === "started" && this._forEach((r) => r.start());
      }
    }
    get phase() {
      return this._phase;
    }
    set phase(e) {
      this._phase = e, this._forEach((r, n) => r.phase = this._phase + n / this.count * 360);
    }
    get baseType() {
      return this._oscillators[0].baseType;
    }
    set baseType(e) {
      this._forEach((r) => r.baseType = e), this._type = this._oscillators[0].type;
    }
    get partials() {
      return this._oscillators[0].partials;
    }
    set partials(e) {
      this._partials = e, this._partialCount = this._partials.length, e.length && (this._type = "custom", this._forEach((r) => r.partials = e));
    }
    get partialCount() {
      return this._oscillators[0].partialCount;
    }
    set partialCount(e) {
      this._partialCount = e, this._forEach((r) => r.partialCount = e), this._type = this._oscillators[0].type;
    }
    asArray() {
      return oe(this, arguments, void 0, function* (e = 1024) {
        return Dt(this, e);
      });
    }
    dispose() {
      return super.dispose(), this.frequency.dispose(), this.detune.dispose(), this._forEach((e) => e.dispose()), this;
    }
  };
  var zi = class t extends pe {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["frequency", "modulationFrequency"]);
      super(e), this.name = "PWMOscillator", this.sourceType = "pwm", this._scale = new We({ context: this.context, value: 2 }), this._pulse = new uo({ context: this.context, frequency: e.modulationFrequency }), this._pulse.carrierType = "sine", this.modulationFrequency = this._pulse.frequency, this._modulator = new Oe({ context: this.context, detune: e.detune, frequency: e.frequency, onstop: () => this.onstop(this), phase: e.phase }), this.frequency = this._modulator.frequency, this.detune = this._modulator.detune, this._modulator.chain(this._scale, this._pulse.width), this._pulse.connect(this.output), z(this, ["modulationFrequency", "frequency", "detune"]);
    }
    static getDefaults() {
      return Object.assign(pe.getDefaults(), { detune: 0, frequency: 440, modulationFrequency: 0.4, phase: 0, type: "pwm" });
    }
    _start(e) {
      e = this.toSeconds(e), this._modulator.start(e), this._pulse.start(e);
    }
    _stop(e) {
      e = this.toSeconds(e), this._modulator.stop(e), this._pulse.stop(e);
    }
    _restart(e) {
      this._modulator.restart(e), this._pulse.restart(e);
    }
    get type() {
      return "pwm";
    }
    get baseType() {
      return "pwm";
    }
    get partials() {
      return [];
    }
    get partialCount() {
      return 0;
    }
    get phase() {
      return this._modulator.phase;
    }
    set phase(e) {
      this._modulator.phase = e;
    }
    asArray() {
      return oe(this, arguments, void 0, function* (e = 1024) {
        return Dt(this, e);
      });
    }
    dispose() {
      return super.dispose(), this._pulse.dispose(), this._scale.dispose(), this._modulator.dispose(), this;
    }
  };
  var Sv = { am: qi, fat: ji, fm: vs, oscillator: Oe, pulse: uo, pwm: zi }, co = class t extends pe {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["frequency", "type"]);
      super(e), this.name = "OmniOscillator", this.frequency = new J({ context: this.context, units: "frequency", value: e.frequency }), this.detune = new J({ context: this.context, units: "cents", value: e.detune }), z(this, ["frequency", "detune"]), this.set(e);
    }
    static getDefaults() {
      return Object.assign(Oe.getDefaults(), vs.getDefaults(), qi.getDefaults(), ji.getDefaults(), uo.getDefaults(), zi.getDefaults());
    }
    _start(e) {
      this._oscillator.start(e);
    }
    _stop(e) {
      this._oscillator.stop(e);
    }
    _restart(e) {
      return this._oscillator.restart(e), this;
    }
    get type() {
      let e = "";
      return ["am", "fm", "fat"].some((r) => this._sourceType === r) && (e = this._sourceType), e + this._oscillator.type;
    }
    set type(e) {
      e.substr(0, 2) === "fm" ? (this._createNewOscillator("fm"), this._oscillator = this._oscillator, this._oscillator.type = e.substr(2)) : e.substr(0, 2) === "am" ? (this._createNewOscillator("am"), this._oscillator = this._oscillator, this._oscillator.type = e.substr(2)) : e.substr(0, 3) === "fat" ? (this._createNewOscillator("fat"), this._oscillator = this._oscillator, this._oscillator.type = e.substr(3)) : e === "pwm" ? (this._createNewOscillator("pwm"), this._oscillator = this._oscillator) : e === "pulse" ? this._createNewOscillator("pulse") : (this._createNewOscillator("oscillator"), this._oscillator = this._oscillator, this._oscillator.type = e);
    }
    get partials() {
      return this._oscillator.partials;
    }
    set partials(e) {
      !this._getOscType(this._oscillator, "pulse") && !this._getOscType(this._oscillator, "pwm") && (this._oscillator.partials = e);
    }
    get partialCount() {
      return this._oscillator.partialCount;
    }
    set partialCount(e) {
      !this._getOscType(this._oscillator, "pulse") && !this._getOscType(this._oscillator, "pwm") && (this._oscillator.partialCount = e);
    }
    set(e) {
      return Reflect.has(e, "type") && e.type && (this.type = e.type), super.set(e), this;
    }
    _createNewOscillator(e) {
      if (e !== this._sourceType) {
        this._sourceType = e;
        let r = Sv[e], n = this.now();
        if (this._oscillator) {
          let o = this._oscillator;
          o.stop(n), this.context.setTimeout(() => o.dispose(), this.blockTime);
        }
        this._oscillator = new r({ context: this.context }), this.frequency.connect(this._oscillator.frequency), this.detune.connect(this._oscillator.detune), this._oscillator.connect(this.output), this._oscillator.onstop = () => this.onstop(this), this.state === "started" && this._oscillator.start(n);
      }
    }
    get phase() {
      return this._oscillator.phase;
    }
    set phase(e) {
      this._oscillator.phase = e;
    }
    get sourceType() {
      return this._sourceType;
    }
    set sourceType(e) {
      let r = "sine";
      this._oscillator.type !== "pwm" && this._oscillator.type !== "pulse" && (r = this._oscillator.type), e === "fm" ? this.type = "fm" + r : e === "am" ? this.type = "am" + r : e === "fat" ? this.type = "fat" + r : e === "oscillator" ? this.type = r : e === "pulse" ? this.type = "pulse" : e === "pwm" && (this.type = "pwm");
    }
    _getOscType(e, r) {
      return e instanceof Sv[r];
    }
    get baseType() {
      return this._oscillator.baseType;
    }
    set baseType(e) {
      !this._getOscType(this._oscillator, "pulse") && !this._getOscType(this._oscillator, "pwm") && e !== "pulse" && e !== "pwm" && (this._oscillator.baseType = e);
    }
    get width() {
      if (this._getOscType(this._oscillator, "pulse")) return this._oscillator.width;
    }
    get count() {
      if (this._getOscType(this._oscillator, "fat")) return this._oscillator.count;
    }
    set count(e) {
      this._getOscType(this._oscillator, "fat") && yt(e) && (this._oscillator.count = e);
    }
    get spread() {
      if (this._getOscType(this._oscillator, "fat")) return this._oscillator.spread;
    }
    set spread(e) {
      this._getOscType(this._oscillator, "fat") && yt(e) && (this._oscillator.spread = e);
    }
    get modulationType() {
      if (this._getOscType(this._oscillator, "fm") || this._getOscType(this._oscillator, "am")) return this._oscillator.modulationType;
    }
    set modulationType(e) {
      (this._getOscType(this._oscillator, "fm") || this._getOscType(this._oscillator, "am")) && ct(e) && (this._oscillator.modulationType = e);
    }
    get modulationIndex() {
      if (this._getOscType(this._oscillator, "fm")) return this._oscillator.modulationIndex;
    }
    get harmonicity() {
      if (this._getOscType(this._oscillator, "fm") || this._getOscType(this._oscillator, "am")) return this._oscillator.harmonicity;
    }
    get modulationFrequency() {
      if (this._getOscType(this._oscillator, "pwm")) return this._oscillator.modulationFrequency;
    }
    asArray() {
      return oe(this, arguments, void 0, function* (e = 1024) {
        return Dt(this, e);
      });
    }
    dispose() {
      return super.dispose(), this.detune.dispose(), this.frequency.dispose(), this._oscillator.dispose(), this;
    }
  };
  function Ql(t, e = 1 / 0) {
    let r = /* @__PURE__ */ new WeakMap();
    return function(n, o) {
      Reflect.defineProperty(n, o, { configurable: true, enumerable: true, get: function() {
        return r.get(this);
      }, set: function(s) {
        Ke(s, t, e), r.set(this, s);
      } });
    };
  }
  function Mt(t, e = 1 / 0) {
    let r = /* @__PURE__ */ new WeakMap();
    return function(n, o) {
      Reflect.defineProperty(n, o, { configurable: true, enumerable: true, get: function() {
        return r.get(this);
      }, set: function(s) {
        Ke(this.toSeconds(s), t, e), r.set(this, s);
      } });
    };
  }
  var Wi = class t extends pe {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["url", "onload"]);
      super(e), this.name = "Player", this._activeSources = /* @__PURE__ */ new Set(), this._buffer = new Ye({ onload: this._onload.bind(this, e.onload), onerror: e.onerror, reverse: e.reverse, url: e.url }), this.autostart = e.autostart, this._loop = e.loop, this._loopStart = e.loopStart, this._loopEnd = e.loopEnd, this._playbackRate = e.playbackRate, this.fadeIn = e.fadeIn, this.fadeOut = e.fadeOut;
    }
    static getDefaults() {
      return Object.assign(pe.getDefaults(), { autostart: false, fadeIn: 0, fadeOut: 0, loop: false, loopEnd: 0, loopStart: 0, onload: Z, onerror: Z, playbackRate: 1, reverse: false });
    }
    load(e) {
      return oe(this, void 0, void 0, function* () {
        return yield this._buffer.load(e), this._onload(), this;
      });
    }
    _onload(e = Z) {
      e(), this.autostart && this.start();
    }
    _onSourceEnd(e) {
      this.onstop(this), this._activeSources.delete(e), this._activeSources.size === 0 && !this._synced && this._state.getValueAtTime(this.now()) === "started" && (this._state.cancel(this.now()), this._state.setStateAtTime("stopped", this.now()));
    }
    start(e, r, n) {
      return super.start(e, r, n), this;
    }
    _start(e, r, n) {
      this._loop ? r = qt(r, this._loopStart) : r = qt(r, 0);
      let o = this.toSeconds(r), s = n;
      n = qt(n, Math.max(this._buffer.duration - o, 0));
      let i = this.toSeconds(n);
      i = i / this._playbackRate, e = this.toSeconds(e);
      let a = new en({ url: this._buffer, context: this.context, fadeIn: this.fadeIn, fadeOut: this.fadeOut, loop: this._loop, loopEnd: this._loopEnd, loopStart: this._loopStart, onended: this._onSourceEnd.bind(this), playbackRate: this._playbackRate }).connect(this.output);
      !this._loop && !this._synced && (this._state.cancel(e + i), this._state.setStateAtTime("stopped", e + i, { implicitEnd: true })), this._activeSources.add(a), this._loop && Ie(s) ? a.start(e, o) : a.start(e, o, i - this.toSeconds(this.fadeOut));
    }
    _stop(e) {
      let r = this.toSeconds(e);
      this._activeSources.forEach((n) => n.stop(r));
    }
    restart(e, r, n) {
      return super.restart(e, r, n), this;
    }
    _restart(e, r, n) {
      var o;
      (o = [...this._activeSources].pop()) === null || o === void 0 || o.stop(e), this._start(e, r, n);
    }
    seek(e, r) {
      let n = this.toSeconds(r);
      if (this._state.getValueAtTime(n) === "started") {
        let o = this.toSeconds(e);
        this._stop(n), this._start(n, o);
      }
      return this;
    }
    setLoopPoints(e, r) {
      return this.loopStart = e, this.loopEnd = r, this;
    }
    get loopStart() {
      return this._loopStart;
    }
    set loopStart(e) {
      this._loopStart = e, this.buffer.loaded && Ke(this.toSeconds(e), 0, this.buffer.duration), this._activeSources.forEach((r) => {
        r.loopStart = e;
      });
    }
    get loopEnd() {
      return this._loopEnd;
    }
    set loopEnd(e) {
      this._loopEnd = e, this.buffer.loaded && Ke(this.toSeconds(e), 0, this.buffer.duration), this._activeSources.forEach((r) => {
        r.loopEnd = e;
      });
    }
    get buffer() {
      return this._buffer;
    }
    set buffer(e) {
      this._buffer.set(e);
    }
    get loop() {
      return this._loop;
    }
    set loop(e) {
      if (this._loop !== e && (this._loop = e, this._activeSources.forEach((r) => {
        r.loop = e;
      }), e)) {
        let r = this._state.getNextState("stopped", this.now());
        r && this._state.cancel(r.time);
      }
    }
    get playbackRate() {
      return this._playbackRate;
    }
    set playbackRate(e) {
      this._playbackRate = e;
      let r = this.now(), n = this._state.getNextState("stopped", r);
      n && n.implicitEnd && (this._state.cancel(n.time), this._activeSources.forEach((o) => o.cancelStop())), this._activeSources.forEach((o) => {
        o.playbackRate.setValueAtTime(e, r);
      });
    }
    get reverse() {
      return this._buffer.reverse;
    }
    set reverse(e) {
      this._buffer.reverse = e;
    }
    get loaded() {
      return this._buffer.loaded;
    }
    dispose() {
      return super.dispose(), this._activeSources.forEach((e) => e.dispose()), this._activeSources.clear(), this._buffer.dispose(), this;
    }
  };
  pt([Mt(0)], Wi.prototype, "fadeIn", void 0);
  pt([Mt(0)], Wi.prototype, "fadeOut", void 0);
  var Tt = class t extends V {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["attack", "decay", "sustain", "release"]);
      super(e), this.name = "Envelope", this._sig = new J({ context: this.context, value: 0 }), this.output = this._sig, this.input = void 0, this.attack = e.attack, this.decay = e.decay, this.sustain = e.sustain, this.release = e.release, this.attackCurve = e.attackCurve, this.releaseCurve = e.releaseCurve, this.decayCurve = e.decayCurve;
    }
    static getDefaults() {
      return Object.assign(V.getDefaults(), { attack: 0.01, attackCurve: "linear", decay: 0.1, decayCurve: "exponential", release: 1, releaseCurve: "exponential", sustain: 0.5 });
    }
    get value() {
      return this.getValueAtTime(this.now());
    }
    _getCurve(e, r) {
      if (ct(e)) return e;
      {
        let n;
        for (n in Hl) if (Hl[n][r] === e) return n;
        return e;
      }
    }
    _setCurve(e, r, n) {
      if (ct(n) && Reflect.has(Hl, n)) {
        let o = Hl[n];
        _r(o) ? e !== "_decayCurve" && (this[e] = o[r]) : this[e] = o;
      } else if (Pe(n) && e !== "_decayCurve") this[e] = n;
      else throw new Error("Envelope: invalid curve: " + n);
    }
    get attackCurve() {
      return this._getCurve(this._attackCurve, "In");
    }
    set attackCurve(e) {
      this._setCurve("_attackCurve", "In", e);
    }
    get releaseCurve() {
      return this._getCurve(this._releaseCurve, "Out");
    }
    set releaseCurve(e) {
      this._setCurve("_releaseCurve", "Out", e);
    }
    get decayCurve() {
      return this._getCurve(this._decayCurve, "Out");
    }
    set decayCurve(e) {
      this._setCurve("_decayCurve", "Out", e);
    }
    triggerAttack(e, r = 1) {
      this.log("triggerAttack", e, r), e = this.toSeconds(e);
      let o = this.toSeconds(this.attack), s = this.toSeconds(this.decay), i = this.getValueAtTime(e);
      if (i > 0) {
        let a = 1 / o;
        o = (1 - i) / a;
      }
      if (o < this.sampleTime) this._sig.cancelScheduledValues(e), this._sig.setValueAtTime(r, e);
      else if (this._attackCurve === "linear") this._sig.linearRampTo(r, o, e);
      else if (this._attackCurve === "exponential") this._sig.targetRampTo(r, o, e);
      else {
        this._sig.cancelAndHoldAtTime(e);
        let a = this._attackCurve;
        for (let l = 1; l < a.length; l++) if (a[l - 1] <= i && i <= a[l]) {
          a = this._attackCurve.slice(l), a[0] = i;
          break;
        }
        this._sig.setValueCurveAtTime(a, e, o, r);
      }
      if (s && this.sustain < 1) {
        let a = r * this.sustain, l = e + o;
        this.log("decay", l), this._decayCurve === "linear" ? this._sig.linearRampToValueAtTime(a, s + l) : this._sig.exponentialApproachValueAtTime(a, l, s);
      }
      return this;
    }
    triggerRelease(e) {
      this.log("triggerRelease", e), e = this.toSeconds(e);
      let r = this.getValueAtTime(e);
      if (r > 0) {
        let n = this.toSeconds(this.release);
        n < this.sampleTime ? this._sig.setValueAtTime(0, e) : this._releaseCurve === "linear" ? this._sig.linearRampTo(0, n, e) : this._releaseCurve === "exponential" ? this._sig.targetRampTo(0, n, e) : (Q(Pe(this._releaseCurve), "releaseCurve must be either 'linear', 'exponential' or an array"), this._sig.cancelAndHoldAtTime(e), this._sig.setValueCurveAtTime(this._releaseCurve, e, n, r));
      }
      return this;
    }
    getValueAtTime(e) {
      return this._sig.getValueAtTime(e);
    }
    triggerAttackRelease(e, r, n = 1) {
      return r = this.toSeconds(r), this.triggerAttack(r, n), this.triggerRelease(r + this.toSeconds(e)), this;
    }
    cancel(e) {
      return this._sig.cancelScheduledValues(this.toSeconds(e)), this;
    }
    connect(e, r = 0, n = 0) {
      return ms(this, e, r, n), this;
    }
    asArray() {
      return oe(this, arguments, void 0, function* (e = 1024) {
        let r = e / this.context.sampleRate, n = new Vr(1, r, this.context.sampleRate), o = this.toSeconds(this.attack) + this.toSeconds(this.decay), s = o + this.toSeconds(this.release), i = s * 0.1, a = s + i, l = new this.constructor(Object.assign(this.get(), { attack: r * this.toSeconds(this.attack) / a, decay: r * this.toSeconds(this.decay) / a, release: r * this.toSeconds(this.release) / a, context: n }));
        return l._sig.toDestination(), l.triggerAttackRelease(r * (o + i) / a, 0), (yield n.render()).getChannelData(0);
      });
    }
    dispose() {
      return super.dispose(), this._sig.dispose(), this;
    }
  };
  pt([Mt(0)], Tt.prototype, "attack", void 0);
  pt([Mt(0)], Tt.prototype, "decay", void 0);
  pt([Ql(0, 1)], Tt.prototype, "sustain", void 0);
  pt([Mt(0)], Tt.prototype, "release", void 0);
  var Hl = (() => {
    let e, r, n = [];
    for (e = 0; e < 128; e++) n[e] = Math.sin(e / 127 * (Math.PI / 2));
    let o = [], s = 6.4;
    for (e = 0; e < 127; e++) {
      r = e / 127;
      let p = Math.sin(r * (Math.PI * 2) * s - Math.PI / 2) + 1;
      o[e] = p / 10 + r * 0.83;
    }
    o[127] = 1;
    let i = [], a = 5;
    for (e = 0; e < 128; e++) i[e] = Math.ceil(e / 127 * a) / a;
    let l = [];
    for (e = 0; e < 128; e++) r = e / 127, l[e] = 0.5 * (1 - Math.cos(Math.PI * r));
    let u = [];
    for (e = 0; e < 128; e++) {
      r = e / 127;
      let p = Math.pow(r, 3) * 4 + 0.2, d = Math.cos(p * Math.PI * 2 * r);
      u[e] = Math.abs(d * (1 - r));
    }
    function c(p) {
      let d = new Array(p.length);
      for (let m = 0; m < p.length; m++) d[m] = 1 - p[m];
      return d;
    }
    function h(p) {
      return p.slice(0).reverse();
    }
    return { bounce: { In: c(u), Out: u }, cosine: { In: n, Out: h(n) }, exponential: "exponential", linear: "linear", ripple: { In: o, Out: c(o) }, sine: { In: l, Out: c(l) }, step: { In: i, Out: c(i) } };
  })();
  var Sr = class t extends V {
    constructor() {
      let e = O(t.getDefaults(), arguments);
      super(e), this._scheduledEvents = [], this._synced = false, this._original_triggerAttack = this.triggerAttack, this._original_triggerRelease = this.triggerRelease, this._syncedRelease = (r) => this._original_triggerRelease(r), this._volume = this.output = new or({ context: this.context, volume: e.volume }), this.volume = this._volume.volume, z(this, "volume");
    }
    static getDefaults() {
      return Object.assign(V.getDefaults(), { volume: 0 });
    }
    sync() {
      return this._syncState() && (this._syncMethod("triggerAttack", 1), this._syncMethod("triggerRelease", 0), this.context.transport.on("stop", this._syncedRelease), this.context.transport.on("pause", this._syncedRelease), this.context.transport.on("loopEnd", this._syncedRelease)), this;
    }
    _syncState() {
      let e = false;
      return this._synced || (this._synced = true, e = true), e;
    }
    _syncMethod(e, r) {
      let n = this["_original_" + e] = this[e];
      this[e] = (...o) => {
        let s = o[r], i = this.context.transport.schedule((a) => {
          o[r] = a, n.apply(this, o);
        }, s);
        this._scheduledEvents.push(i);
      };
    }
    unsync() {
      return this._scheduledEvents.forEach((e) => this.context.transport.clear(e)), this._scheduledEvents = [], this._synced && (this._synced = false, this.triggerAttack = this._original_triggerAttack, this.triggerRelease = this._original_triggerRelease, this.context.transport.off("stop", this._syncedRelease), this.context.transport.off("pause", this._syncedRelease), this.context.transport.off("loopEnd", this._syncedRelease)), this;
    }
    triggerAttackRelease(e, r, n, o) {
      let s = this.toSeconds(n), i = this.toSeconds(r);
      return this.triggerAttack(e, s, o), this.triggerRelease(s + i), this;
    }
    dispose() {
      return super.dispose(), this._volume.dispose(), this.unsync(), this._scheduledEvents = [], this;
    }
  };
  var Bt = class t extends Sr {
    constructor() {
      let e = O(t.getDefaults(), arguments);
      super(e), this.portamento = e.portamento, this.onsilence = e.onsilence;
    }
    static getDefaults() {
      return Object.assign(Sr.getDefaults(), { detune: 0, onsilence: Z, portamento: 0 });
    }
    triggerAttack(e, r, n = 1) {
      this.log("triggerAttack", e, r, n);
      let o = this.toSeconds(r);
      return this._triggerEnvelopeAttack(o, n), this.setNote(e, o), this;
    }
    triggerRelease(e) {
      this.log("triggerRelease", e);
      let r = this.toSeconds(e);
      return this._triggerEnvelopeRelease(r), this;
    }
    setNote(e, r) {
      let n = this.toSeconds(r), o = e instanceof bt ? e.toFrequency() : e;
      if (this.portamento > 0 && this.getLevelAtTime(n) > 0.05) {
        let s = this.toSeconds(this.portamento);
        this.frequency.exponentialRampTo(o, s, n);
      } else this.frequency.setValueAtTime(o, n);
      return this;
    }
  };
  pt([Mt(0)], Bt.prototype, "portamento", void 0);
  var ws = class t extends Tt {
    constructor() {
      super(O(t.getDefaults(), arguments, ["attack", "decay", "sustain", "release"])), this.name = "AmplitudeEnvelope", this._gainNode = new H({ context: this.context, gain: 0 }), this.output = this._gainNode, this.input = this._gainNode, this._sig.connect(this._gainNode.gain), this.output = this._gainNode, this.input = this._gainNode;
    }
    dispose() {
      return super.dispose(), this._gainNode.dispose(), this;
    }
  };
  var tn = class t extends Bt {
    constructor() {
      let e = O(t.getDefaults(), arguments);
      super(e), this.name = "Synth", this.oscillator = new co(Object.assign({ context: this.context, detune: e.detune, onstop: () => this.onsilence(this) }, e.oscillator)), this.frequency = this.oscillator.frequency, this.detune = this.oscillator.detune, this.envelope = new ws(Object.assign({ context: this.context }, e.envelope)), this.oscillator.chain(this.envelope, this.output), z(this, ["oscillator", "frequency", "detune", "envelope"]);
    }
    static getDefaults() {
      return Object.assign(Bt.getDefaults(), { envelope: Object.assign(Pr(Tt.getDefaults(), Object.keys(V.getDefaults())), { attack: 5e-3, decay: 0.1, release: 1, sustain: 0.3 }), oscillator: Object.assign(Pr(co.getDefaults(), [...Object.keys(pe.getDefaults()), "frequency", "detune"]), { type: "triangle" }) });
    }
    _triggerEnvelopeAttack(e, r) {
      if (this.envelope.triggerAttack(e, r), this.oscillator.start(e), this.envelope.sustain === 0) {
        let n = this.toSeconds(this.envelope.attack), o = this.toSeconds(this.envelope.decay);
        this.oscillator.stop(e + n + o);
      }
    }
    _triggerEnvelopeRelease(e) {
      this.envelope.triggerRelease(e), this.oscillator.stop(e + this.toSeconds(this.envelope.release));
    }
    getLevelAtTime(e) {
      return e = this.toSeconds(e), this.envelope.getValueAtTime(e);
    }
    dispose() {
      return super.dispose(), this.oscillator.dispose(), this.envelope.dispose(), this;
    }
  };
  var Yl = class t extends tn {
    constructor() {
      let e = O(t.getDefaults(), arguments);
      super(e), this.name = "MembraneSynth", this.portamento = 0, this.pitchDecay = e.pitchDecay, this.octaves = e.octaves, z(this, ["oscillator", "envelope"]);
    }
    static getDefaults() {
      return yr(Bt.getDefaults(), tn.getDefaults(), { envelope: { attack: 1e-3, attackCurve: "exponential", decay: 0.4, release: 1.4, sustain: 0.01 }, octaves: 10, oscillator: { type: "sine" }, pitchDecay: 0.05 });
    }
    setNote(e, r) {
      let n = this.toSeconds(r), o = this.toFrequency(e instanceof bt ? e.toFrequency() : e), s = o * this.octaves;
      return this.oscillator.frequency.setValueAtTime(s, n), this.oscillator.frequency.exponentialRampToValueAtTime(o, n + this.toSeconds(this.pitchDecay)), this;
    }
    dispose() {
      return super.dispose(), this;
    }
  };
  pt([Ql(0)], Yl.prototype, "octaves", void 0);
  pt([Mt(0)], Yl.prototype, "pitchDecay", void 0);
  var Av = /* @__PURE__ */ new Set();
  function Ts(t) {
    Av.add(t);
  }
  function Xl(t, e) {
    let r = `registerProcessor("${t}", ${e})`;
    Av.add(r);
  }
  var fT = `
	/**
	 * The base AudioWorkletProcessor for use in Tone.js. Works with the {@link ToneAudioWorklet}. 
	 */
	class ToneAudioWorkletProcessor extends AudioWorkletProcessor {

		constructor(options) {
			
			super(options);
			/**
			 * If the processor was disposed or not. Keep alive until it's disposed.
			 */
			this.disposed = false;
		   	/** 
			 * The number of samples in the processing block
			 */
			this.blockSize = 128;
			/**
			 * the sample rate
			 */
			this.sampleRate = sampleRate;

			this.port.onmessage = (event) => {
				// when it receives a dispose 
				if (event.data === "dispose") {
					this.disposed = true;
				}
			};
		}
	}
`;
  Ts(fT);
  var dT = `
	/**
	 * Abstract class for a single input/output processor. 
	 * has a 'generate' function which processes one sample at a time
	 */
	class SingleIOProcessor extends ToneAudioWorkletProcessor {

		constructor(options) {
			super(Object.assign(options, {
				numberOfInputs: 1,
				numberOfOutputs: 1
			}));
			/**
			 * Holds the name of the parameter and a single value of that
			 * parameter at the current sample
			 * @type { [name: string]: number }
			 */
			this.params = {}
		}

		/**
		 * Generate an output sample from the input sample and parameters
		 * @abstract
		 * @param input number
		 * @param channel number
		 * @param parameters { [name: string]: number }
		 * @returns number
		 */
		generate(){}

		/**
		 * Update the private params object with the 
		 * values of the parameters at the given index
		 * @param parameters { [name: string]: Float32Array },
		 * @param index number
		 */
		updateParams(parameters, index) {
			for (const paramName in parameters) {
				const param = parameters[paramName];
				if (param.length > 1) {
					this.params[paramName] = parameters[paramName][index];
				} else {
					this.params[paramName] = parameters[paramName][0];
				}
			}
		}

		/**
		 * Process a single frame of the audio
		 * @param inputs Float32Array[][]
		 * @param outputs Float32Array[][]
		 */
		process(inputs, outputs, parameters) {
			const input = inputs[0];
			const output = outputs[0];
			// get the parameter values
			const channelCount = Math.max(input && input.length || 0, output.length);
			for (let sample = 0; sample < this.blockSize; sample++) {
				this.updateParams(parameters, sample);
				for (let channel = 0; channel < channelCount; channel++) {
					const inputSample = input && input.length ? input[channel][sample] : 0;
					output[channel][sample] = this.generate(inputSample, channel, this.params);
				}
			}
			return !this.disposed;
		}
	};
`;
  Ts(dT);
  var mT = `
	/**
	 * A multichannel buffer for use within an AudioWorkletProcessor as a delay line
	 */
	class DelayLine {
		
		constructor(size, channels) {
			this.buffer = [];
			this.writeHead = []
			this.size = size;

			// create the empty channels
			for (let i = 0; i < channels; i++) {
				this.buffer[i] = new Float32Array(this.size);
				this.writeHead[i] = 0;
			}
		}

		/**
		 * Push a value onto the end
		 * @param channel number
		 * @param value number
		 */
		push(channel, value) {
			this.writeHead[channel] += 1;
			if (this.writeHead[channel] > this.size) {
				this.writeHead[channel] = 0;
			}
			this.buffer[channel][this.writeHead[channel]] = value;
		}

		/**
		 * Get the recorded value of the channel given the delay
		 * @param channel number
		 * @param delay number delay samples
		 */
		get(channel, delay) {
			let readHead = this.writeHead[channel] - Math.floor(delay);
			if (readHead < 0) {
				readHead += this.size;
			}
			return this.buffer[channel][readHead];
		}
	}
`;
  Ts(mT);
  var kv = "feedback-comb-filter", gT = `
	class FeedbackCombFilterWorklet extends SingleIOProcessor {

		constructor(options) {
			super(options);
			this.delayLine = new DelayLine(this.sampleRate, options.channelCount || 2);
		}

		static get parameterDescriptors() {
			return [{
				name: "delayTime",
				defaultValue: 0.1,
				minValue: 0,
				maxValue: 1,
				automationRate: "k-rate"
			}, {
				name: "feedback",
				defaultValue: 0.5,
				minValue: 0,
				maxValue: 0.9999,
				automationRate: "k-rate"
			}];
		}

		generate(input, channel, parameters) {
			const delayedSample = this.delayLine.get(channel, parameters.delayTime * this.sampleRate);
			this.delayLine.push(channel, input + delayedSample * parameters.feedback);
			return delayedSample;
		}
	}
`;
  Xl(kv, gT);
  var Zl = class t extends Sr {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["urls", "onload", "baseUrl"], "urls");
      super(e), this.name = "Sampler", this._activeSources = /* @__PURE__ */ new Map();
      let r = {};
      Object.keys(e.urls).forEach((n) => {
        let o = parseInt(n, 10);
        if (Q(Ii(n) || yt(o) && isFinite(o), `url key is neither a note or midi pitch: ${n}`), Ii(n)) {
          let s = new bt(this.context, n).toMidi();
          r[s] = e.urls[n];
        } else yt(o) && isFinite(o) && (r[o] = e.urls[o]);
      }), this._buffers = new _s({ urls: r, onload: e.onload, baseUrl: e.baseUrl, onerror: e.onerror }), this.attack = e.attack, this.release = e.release, this.curve = e.curve, this._buffers.loaded && Promise.resolve().then(e.onload);
    }
    static getDefaults() {
      return Object.assign(Sr.getDefaults(), { attack: 0, baseUrl: "", curve: "exponential", onload: Z, onerror: Z, release: 0.1, urls: {} });
    }
    _findClosest(e) {
      let n = 0;
      for (; n < 96; ) {
        if (this._buffers.has(e + n)) return -n;
        if (this._buffers.has(e - n)) return n;
        n++;
      }
      throw new Error(`No available buffers for note: ${e}`);
    }
    triggerAttack(e, r, n = 1) {
      return this.log("triggerAttack", e, r, n), Array.isArray(e) || (e = [e]), e.forEach((o) => {
        let s = ap(new bt(this.context, o).toFrequency()), i = Math.round(s), a = s - i, l = this._findClosest(i), u = i - l, c = this._buffers.get(u), h = ao(l + a), p = new en({ url: c, context: this.context, curve: this.curve, fadeIn: this.attack, fadeOut: this.release, playbackRate: h }).connect(this.output);
        p.start(r, 0, c.duration / h, n), Pe(this._activeSources.get(i)) || this._activeSources.set(i, []), this._activeSources.get(i).push(p), p.onended = () => {
          if (this._activeSources && this._activeSources.has(i)) {
            let d = this._activeSources.get(i), m = d.indexOf(p);
            m !== -1 && d.splice(m, 1);
          }
        };
      }), this;
    }
    triggerRelease(e, r) {
      return this.log("triggerRelease", e, r), Array.isArray(e) || (e = [e]), e.forEach((n) => {
        let o = new bt(this.context, n).toMidi();
        if (this._activeSources.has(o) && this._activeSources.get(o).length) {
          let s = this._activeSources.get(o);
          r = this.toSeconds(r), s.forEach((i) => {
            i.stop(r);
          }), this._activeSources.set(o, []);
        }
      }), this;
    }
    releaseAll(e) {
      let r = this.toSeconds(e);
      return this._activeSources.forEach((n) => {
        for (; n.length; ) n.shift().stop(r);
      }), this;
    }
    sync() {
      return this._syncState() && (this._syncMethod("triggerAttack", 1), this._syncMethod("triggerRelease", 1)), this;
    }
    triggerAttackRelease(e, r, n, o = 1) {
      let s = this.toSeconds(n);
      return this.triggerAttack(e, s, o), Pe(r) ? (Q(Pe(e), "notes must be an array when duration is array"), e.forEach((i, a) => {
        let l = r[Math.min(a, r.length - 1)];
        this.triggerRelease(i, s + this.toSeconds(l));
      })) : this.triggerRelease(e, s + this.toSeconds(r)), this;
    }
    add(e, r, n) {
      if (Q(Ii(e) || isFinite(e), `note must be a pitch or midi: ${e}`), Ii(e)) {
        let o = new bt(this.context, e).toMidi();
        this._buffers.add(o, r, n);
      } else this._buffers.add(e, r, n);
      return this;
    }
    get loaded() {
      return this._buffers.loaded;
    }
    dispose() {
      return super.dispose(), this._buffers.dispose(), this._activeSources.forEach((e) => {
        e.forEach((r) => r.dispose());
      }), this._activeSources.clear(), this;
    }
  };
  pt([Mt(0)], Zl.prototype, "attack", void 0);
  pt([Mt(0)], Zl.prototype, "release", void 0);
  var Bi = class t extends V {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["pan"]);
      super(e), this.name = "Panner", this._panner = this.context.createStereoPanner(), this.input = this._panner, this.output = this._panner, this.pan = new te({ context: this.context, param: this._panner.pan, value: e.pan, minValue: -1, maxValue: 1 }), this._panner.channelCount = e.channelCount, this._panner.channelCountMode = "explicit", z(this, "pan");
    }
    static getDefaults() {
      return Object.assign(V.getDefaults(), { pan: 0, channelCount: 1 });
    }
    dispose() {
      return super.dispose(), this._panner.disconnect(), this.pan.dispose(), this;
    }
  };
  var Ov = "bit-crusher", TT = `
	class BitCrusherWorklet extends SingleIOProcessor {

		static get parameterDescriptors() {
			return [{
				name: "bits",
				defaultValue: 12,
				minValue: 1,
				maxValue: 16,
				automationRate: 'k-rate'
			}];
		}

		generate(input, _channel, parameters) {
			const step = Math.pow(0.5, parameters.bits - 1);
			const val = step * Math.floor(input / step + 0.5);
			return val;
		}
	}
`;
  Xl(Ov, TT);
  var Eee = [1557 / 44100, 1617 / 44100, 1491 / 44100, 1422 / 44100, 1277 / 44100, 1356 / 44100, 1188 / 44100, 1116 / 44100];
  var Vee = [1687 / 25e3, 1601 / 25e3, 2053 / 25e3, 2251 / 25e3];
  var As = class t extends V {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["solo"]);
      super(e), this.name = "Solo", this.input = this.output = new H({ context: this.context }), t._allSolos.has(this.context) || t._allSolos.set(this.context, /* @__PURE__ */ new Set()), t._allSolos.get(this.context).add(this), this.solo = e.solo;
    }
    static getDefaults() {
      return Object.assign(V.getDefaults(), { solo: false });
    }
    get solo() {
      return this._isSoloed();
    }
    set solo(e) {
      e ? this._addSolo() : this._removeSolo(), t._allSolos.get(this.context).forEach((r) => r._updateSolo());
    }
    get muted() {
      return this.input.gain.value === 0;
    }
    _addSolo() {
      t._soloed.has(this.context) || t._soloed.set(this.context, /* @__PURE__ */ new Set()), t._soloed.get(this.context).add(this);
    }
    _removeSolo() {
      t._soloed.has(this.context) && t._soloed.get(this.context).delete(this);
    }
    _isSoloed() {
      return t._soloed.has(this.context) && t._soloed.get(this.context).has(this);
    }
    _noSolos() {
      return !t._soloed.has(this.context) || t._soloed.has(this.context) && t._soloed.get(this.context).size === 0;
    }
    _updateSolo() {
      this._isSoloed() ? this.input.gain.value = 1 : this._noSolos() ? this.input.gain.value = 1 : this.input.gain.value = 0;
    }
    dispose() {
      return super.dispose(), t._allSolos.get(this.context).delete(this), this._removeSolo(), this;
    }
  };
  As._allSolos = /* @__PURE__ */ new Map();
  As._soloed = /* @__PURE__ */ new Map();
  var tu = class t extends V {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["pan", "volume"]);
      super(e), this.name = "PanVol", this._panner = this.input = new Bi({ context: this.context, pan: e.pan, channelCount: e.channelCount }), this.pan = this._panner.pan, this._volume = this.output = new or({ context: this.context, volume: e.volume }), this.volume = this._volume.volume, this._panner.connect(this._volume), this.mute = e.mute, z(this, ["pan", "volume"]);
    }
    static getDefaults() {
      return Object.assign(V.getDefaults(), { mute: false, pan: 0, volume: 0, channelCount: 1 });
    }
    get mute() {
      return this._volume.mute;
    }
    set mute(e) {
      this._volume.mute = e;
    }
    dispose() {
      return super.dispose(), this._panner.dispose(), this.pan.dispose(), this._volume.dispose(), this.volume.dispose(), this;
    }
  };
  var gp = class t extends V {
    constructor() {
      let e = O(t.getDefaults(), arguments, ["volume", "pan"]);
      super(e), this.name = "Channel", this._solo = this.input = new As({ solo: e.solo, context: this.context }), this._panVol = this.output = new tu({ context: this.context, pan: e.pan, volume: e.volume, mute: e.mute, channelCount: e.channelCount }), this.pan = this._panVol.pan, this.volume = this._panVol.volume, this._solo.connect(this._panVol), z(this, ["pan", "volume"]);
    }
    static getDefaults() {
      return Object.assign(V.getDefaults(), { pan: 0, volume: 0, mute: false, solo: false, channelCount: 1 });
    }
    get solo() {
      return this._solo.solo;
    }
    set solo(e) {
      this._solo.solo = e;
    }
    get muted() {
      return this._solo.muted || this.mute;
    }
    get mute() {
      return this._panVol.mute;
    }
    set mute(e) {
      this._panVol.mute = e;
    }
    _getBus(e) {
      return t.buses.has(e) || t.buses.set(e, new H({ context: this.context })), t.buses.get(e);
    }
    send(e, r = 0) {
      let n = this._getBus(e), o = new H({ context: this.context, units: "decibels", gain: r });
      return this.connect(o), o.connect(n), o;
    }
    receive(e) {
      return this._getBus(e).connect(this), this;
    }
    dispose() {
      return super.dispose(), this._panVol.dispose(), this.pan.dispose(), this.volume.dispose(), this._solo.dispose(), this;
    }
  };
  gp.buses = /* @__PURE__ */ new Map();
  var wse = Ve().transport;
  var Sse = Ve().destination, Tse = Ve().destination;
  var Ase = Ve().listener;
  var kse = Ve().draw;
  var Cse = Ve();
  var nn = Math.PI * 2, on = (t, e, r) => Math.max(e, Math.min(r, t)), Ui = (t, e) => Math.hypot(t.x - e.x, t.y - e.y), DT = (t, e, r) => {
    let n = r.x - e.x, o = r.y - e.y, s = on(((t.x - e.x) * n + (t.y - e.y) * o) / (n * n + o * o || 1), 0, 1);
    return Math.hypot(t.x - e.x - s * n, t.y - e.y - s * o);
  }, MT = (t) => {
    let e = {};
    for (let r of t.tweaks || []) e[r.id] = r.value;
    for (let r of t.texts || []) e[r.id] = r.value;
    for (let r of t.images || []) e[r.id] = r.path;
    for (let r of t.mentions || []) e[r.id] = r.path || r.value;
    for (let r of t.motions || []) r.base_path && (e[r.id] = r.base_path), r.frame_count != null && (e[r.id + "_COUNT"] = r.frame_count);
    return e;
  };
  function RT() {
    let w = (0, ue.useRef)(null), g = (0, ue.useRef)({ mode: "drawing", w: 0, h: 0, dpr: 1, time: 0, lastFrame: 0, raw: [], blade: [], drawing: false, dragging: false, pointerId: null, hero: { x: 0, y: 0, r: 18, invulnerable: 0 }, dragOffset: { x: 0, y: 0 }, aim: 0, facing: 0, swing: 0, enemies: [], particles: [], nextSpawn: 0, score: 0, lives: 3, bg: null, enemyImage: null, config: null }), y = (0, ue.useRef)({ ready: false, starting: false, synth: null }), [b, O2] = (0, ue.useState)("loading"), [k, I] = (0, ue.useState)({ score: 0, lives: 3 }), [M, G] = (0, ue.useState)(null), [W, A] = (0, ue.useState)(false), [P, B] = (0, ue.useState)({ drawing: true, playing: true }), D = typeof window < "u" && !!window.tt?.playableRecordingSubmission, j = () => {
      if (!(!D || W)) {
        A(true);
        try {
          window.tt.playableRecordingSubmission({ success() {
          }, fail(a) {
            console.error("[post_my_play] failed", a?.errMsg || a?.message);
          }, complete() {
            A(false);
          } });
        } catch {
          A(false);
        }
      }
    }, T = (a) => {
      g.current.mode = a, O2(a);
    }, R = (a = "C5", e = "16n") => {
      try {
        y.current.ready && y.current.synth.triggerAttackRelease(a, e);
      } catch {
      }
    }, q = () => {
      y.current.ready || y.current.starting || (y.current.starting = true, ip().then(() => {
        let a = new tn({ oscillator: { type: "triangle" }, envelope: { attack: 5e-3, decay: 0.06, sustain: 0.1, release: 0.12 } }).toDestination();
        a.volume.value = -17, y.current.synth = a, y.current.ready = true;
      }).catch(() => {
      }).finally(() => {
        y.current.starting = false;
      }));
    };
    (0, ue.useEffect)(() => {
      let a = true, e = (d) => new Promise((r) => {
        if (!d) return r(null);
        let c = new Image();
        c.onload = () => r(c), c.onerror = () => r(null), c.src = d;
      });
      return (async () => {
        let d = { tweaks: [], texts: [], images: [] };
        try {
          let x = await fetch("./game.config.json", { cache: "no-store" });
          x.ok && (d = await x.json());
        } catch {
        }
        let r = MT(d), [c, p] = await Promise.all([e(r.BG_MAIN), e(r.TARGET_IMG)]);
        a && (Object.assign(g.current, { bg: c, enemyImage: p, config: r }), G(r), T("drawing"));
      })(), () => {
        a = false, y.current.synth?.dispose();
      };
    }, []);
    let F = (a) => {
      let e = w.current.getBoundingClientRect();
      return { x: a.clientX - e.left, y: a.clientY - e.top };
    }, N = (a) => ({ left: 28, right: a.w - 28, top: 112, bottom: a.h - 100 }), z2 = () => {
      let a = g.current;
      a.raw = [], a.blade = [], a.drawing = false, a.dragging = false, a.pointerId = null, a.enemies = [], a.particles = [], a.score = 0, a.lives = 3, a.nextSpawn = 0, a.hero.x = a.w / 2, a.hero.y = on(a.h * 0.57, 140, a.h - 120), a.hero.invulnerable = 0, B({ drawing: true, playing: true }), I({ score: 0, lives: 3 }), T("drawing");
    }, L = () => {
      let a = g.current, e = a.raw;
      if (e.length < 3) {
        a.raw = [];
        return;
      }
      let d = 0;
      for (let l = 1; l < e.length; l++) d += Ui(e[l - 1], e[l]);
      if (d < 42) {
        a.raw = [];
        return;
      }
      let r = e[0], c = e[e.length - 1], p = Ui(r, c) > 22 ? Math.atan2(c.y - r.y, c.x - r.x) : Math.atan2(e[Math.floor(e.length / 2)].y - r.y, e[Math.floor(e.length / 2)].x - r.x), x = -Math.PI / 2 - p, S = Math.cos(x), i = Math.sin(x), t = e.map((l) => ({ x: (l.x - r.x) * S - (l.y - r.y) * i, y: (l.x - r.x) * i + (l.y - r.y) * S })), s = Math.min(...t.map((l) => l.x)), o = Math.max(...t.map((l) => l.x)), m = Math.min(...t.map((l) => l.y)), u = Math.max(...t.map((l) => l.y)), f = on(78 / Math.max(o - s, u - m, 1), 0.25, 2.2);
      t = t.map((l) => ({ x: (l.x - (s + o) / 2) * f, y: (l.y - u) * f - 30 })), a.blade = t, a.hero.x = a.w / 2, a.hero.y = on(a.h * 0.57, 150, a.h - 120), a.hero.invulnerable = 0, a.score = 0, a.lives = 3, a.enemies = [], a.particles = [], a.nextSpawn = a.time + 750, a.aim = 0, a.facing = 0, a.swing = 0, I({ score: 0, lives: 3 }), T("playing"), R("E5");
    }, U = (a) => {
      if (a.isPrimary === false) return;
      let e = g.current;
      if (e.mode !== "drawing" && e.mode !== "playing") return;
      a.preventDefault(), q(), B((r) => r[e.mode] ? { ...r, [e.mode]: false } : r);
      let d = F(a);
      e.pointerId = a.pointerId, w.current.setPointerCapture?.(a.pointerId), e.mode === "drawing" ? (e.raw = [d], e.drawing = true) : (e.dragging = true, e.dragOffset = { x: e.hero.x - d.x, y: e.hero.y - d.y });
    }, V2 = (a) => {
      let e = g.current;
      if (a.pointerId !== e.pointerId) return;
      let d = F(a);
      if (e.mode === "drawing" && e.drawing) Ui(d, e.raw[e.raw.length - 1]) > 3 && e.raw.length < 180 && e.raw.push(d);
      else if (e.mode === "playing" && e.dragging) {
        let r = N(e), c = e.hero.x, p = e.hero.y;
        e.hero.x = on(d.x + e.dragOffset.x, r.left, r.right), e.hero.y = on(d.y + e.dragOffset.y, r.top, r.bottom), Math.hypot(e.hero.x - c, e.hero.y - p) > 1 && (e.facing = Math.atan2(e.hero.y - p, e.hero.x - c) + Math.PI / 2);
      }
    }, Y = (a) => {
      let e = g.current;
      a.pointerId === e.pointerId && (e.mode === "drawing" && e.drawing && (e.drawing = false, L()), e.dragging = false, e.pointerId = null, w.current?.hasPointerCapture?.(a.pointerId) && w.current.releasePointerCapture(a.pointerId));
    }, $ = (a) => {
      let e = g.current;
      a.pointerId === e.pointerId && (e.mode === "drawing" && (e.raw = []), e.drawing = false, e.dragging = false, e.pointerId = null);
    };
    return (0, ue.useEffect)(() => {
      if (!M || !w.current) return;
      let a = w.current, e = a.getContext("2d"), d, r = () => {
        let i = g.current, t = a.getBoundingClientRect(), s = i.w, o = i.h;
        i.w = t.width, i.h = t.height, i.dpr = Math.min(window.devicePixelRatio || 1, 3), a.width = Math.round(i.w * i.dpr), a.height = Math.round(i.h * i.dpr), !s || !o ? (i.hero.x = i.w / 2, i.hero.y = on(i.h * 0.57, 150, i.h - 120)) : (i.hero.x *= i.w / s, i.hero.y *= i.h / o);
      };
      r();
      let c = new ResizeObserver(r);
      c.observe(a);
      let p = (i, t, s, o = 9) => {
        let m = g.current;
        for (let u = 0; u < o; u++) {
          let f = u * nn / o + Math.random() * 0.35, l = 60 + Math.random() * 95;
          m.particles.push({ x: i, y: t, vx: Math.cos(f) * l, vy: Math.sin(f) * l, life: 0.5, color: s });
        }
      }, x = (i) => {
        let t = N(i), s = Math.floor(Math.random() * 3), o = 16, m = s === 0 ? t.left - 12 : s === 1 ? t.right + 12 : t.left + Math.random() * (t.right - t.left), u = s === 2 ? t.top - 10 : t.top + Math.random() * (t.bottom - t.top);
        i.enemies.push({ x: m, y: u, r: o, speed: 48 + Math.min(i.score * 3, 34) + Math.random() * 16, phase: Math.random() * nn, hp: 5, maxHp: 5, hitCooldown: 0, flash: 0 });
      }, S = (i) => {
        d = requestAnimationFrame(S);
        let t = g.current, s = t.lastFrame ? Math.min((i - t.lastFrame) / 1e3, 0.04) : 0;
        t.lastFrame = i, t.time += s * 1e3, e.setTransform(t.dpr, 0, 0, t.dpr, 0, 0), e.clearRect(0, 0, t.w, t.h), t.bg ? e.drawImage(t.bg, 0, 0, t.w, t.h) : (e.fillStyle = "#f5f4ef", e.fillRect(0, 0, t.w, t.h)), e.strokeStyle = "rgba(115,126,117,0)", e.lineWidth = 1;
        for (let o = 0; o < t.w; o += 32) e.beginPath(), e.moveTo(o, 0), e.lineTo(o, t.h), e.stroke();
        for (let o = 0; o < t.h; o += 32) e.beginPath(), e.moveTo(0, o), e.lineTo(t.w, o), e.stroke();
        if (t.mode === "drawing") {
          let o = on(t.h * 0.27, 134, 180), m = t.h - 112;
          e.fillStyle = "rgba(255,255,255,.32)", e.strokeStyle = "#d1d6ce", e.lineWidth = 2, e.beginPath(), e.roundRect(30, o, t.w - 60, m - o, 18), e.fill(), e.stroke(), e.setLineDash([7, 8]), e.strokeStyle = "#d5dad2", e.beginPath(), e.moveTo(t.w / 2, o + 22), e.lineTo(t.w / 2, m - 22), e.stroke(), e.setLineDash([]), t.raw.length > 1 && (e.beginPath(), t.raw.forEach((u, f) => f ? e.lineTo(u.x, u.y) : e.moveTo(u.x, u.y)), e.lineCap = "round", e.lineJoin = "round", e.shadowColor = "#303936", e.shadowBlur = 0, e.strokeStyle = "#303936", e.lineWidth = 6, e.stroke());
        }
        if (t.mode === "playing" || t.mode === "over" || t.mode === "won") {
          if (t.mode === "playing") {
            t.time >= t.nextSpawn && (x(t), t.nextSpawn = t.time + Math.max(640, Number(M.SPAWN_INTERVAL) || 1e3)), t.hero.invulnerable = Math.max(0, t.hero.invulnerable - s);
            let h = Math.atan2(Math.sin(t.facing - t.aim), Math.cos(t.facing - t.aim));
            t.aim += on(h, -s * 8, s * 8), t.swing += s * 11;
          }
          let o = t.swing, m = Math.cos(o), u = Math.sin(o), f = t.blade.map((h) => ({ x: t.hero.x + h.x * m - h.y * u, y: t.hero.y + h.x * u + h.y * m })), l = N(t);
          e.strokeStyle = "#d1d6ce", e.lineWidth = 2, e.strokeRect(l.left - 8, l.top - 14, l.right - l.left + 16, l.bottom - l.top + 28);
          for (let h = t.enemies.length - 1; h >= 0; h--) {
            let n = t.enemies[h];
            if (n.hitCooldown = Math.max(0, (n.hitCooldown || 0) - s), n.flash = Math.max(0, (n.flash || 0) - s), t.mode === "playing") {
              let E = Math.max(Ui(n, t.hero), 1);
              n.x += (t.hero.x - n.x) / E * n.speed * s, n.y += (t.hero.y - n.y) / E * n.speed * s;
              let v = false;
              for (let C = 1; C < f.length; C++) if (DT(n, f[C - 1], f[C]) < n.r + 8) {
                v = true;
                break;
              }
              if (v && n.hitCooldown <= 0 && (n.hp--, n.hitCooldown = 0.22, n.flash = 0.13, p(n.x, n.y, "#91a893", 5), R("G5", "32n"), navigator.vibrate?.(6), n.hp <= 0)) {
                p(n.x, n.y, "#b66f68"), t.enemies.splice(h, 1), t.score++, I({ score: t.score, lives: t.lives }), R("G5");
                continue;
              }
              Ui(n, t.hero) < n.r + t.hero.r - 3 && t.hero.invulnerable <= 0 && (t.lives--, t.hero.invulnerable = 1.1, p(t.hero.x, t.hero.y, "#91a893", 12), I({ score: t.score, lives: t.lives }), R("C3", "8n"), t.lives <= 0 && T("over"));
            }
            e.save(), e.translate(n.x, n.y), t.enemyImage ? e.drawImage(t.enemyImage, -n.r, -n.r, n.r * 2, n.r * 2) : (e.fillStyle = "#b66f68", e.beginPath(), e.arc(0, 0, n.r, 0, nn), e.fill()), e.fillStyle = "#252627", e.beginPath(), e.arc(-5, -2, 2.5, 0, nn), e.arc(5, -2, 2.5, 0, nn), e.fill(), n.flash > 0 && (e.strokeStyle = "#91a893", e.lineWidth = 4, e.beginPath(), e.arc(0, 0, n.r + 3, 0, nn), e.stroke()), (() => {
              let E = (n.r * 2 - 8) / 5;
              for (let v = 0; v < 5; v++) e.fillStyle = v < n.hp ? "#91a893" : "#dce0d7", e.fillRect(-n.r + v * (E + 2), -n.r - 10, E, 5);
            })(), e.restore();
          }
          for (let h = t.particles.length - 1; h >= 0; h--) {
            let n = t.particles[h];
            if (n.x += n.vx * s, n.y += n.vy * s, n.life -= s, n.life <= 0) {
              t.particles.splice(h, 1);
              continue;
            }
            e.globalAlpha = n.life * 1.8, e.fillStyle = n.color, e.beginPath(), e.arc(n.x, n.y, 2 + n.life * 3, 0, nn), e.fill(), e.globalAlpha = 1;
          }
          e.save(), e.lineCap = "round", e.lineJoin = "round", e.beginPath(), e.moveTo(t.hero.x, t.hero.y), e.lineTo(t.hero.x + 28 * Math.sin(o), t.hero.y - 28 * Math.cos(o)), e.strokeStyle = "#303936", e.lineWidth = 11, e.stroke(), f.length > 1 && (e.beginPath(), f.forEach((h, n) => n ? e.lineTo(h.x, h.y) : e.moveTo(h.x, h.y)), e.shadowColor = "#303936", e.shadowBlur = 0, e.strokeStyle = "#303936", e.lineWidth = 7, e.stroke()), e.restore(), e.save(), e.translate(t.hero.x, t.hero.y), t.hero.invulnerable > 0 && Math.floor(t.time / 100) % 2 && (e.globalAlpha = 0.4), e.shadowColor = "#303936", e.shadowBlur = 0, e.fillStyle = "#f5f4ef", e.beginPath(), e.arc(0, 0, t.hero.r, 0, nn), e.fill(), e.shadowBlur = 0, e.strokeStyle = "#303936", e.lineWidth = 3, e.stroke(), e.fillStyle = "#252627", e.beginPath(), e.arc(-6, -3, 2.7, 0, nn), e.arc(6, -3, 2.7, 0, nn), e.fill(), e.restore();
        }
      };
      return d = requestAnimationFrame(S), () => {
        cancelAnimationFrame(d), c.disconnect();
      };
    }, [M]), ue.default.createElement("div", { className: "game-shell" }, ue.default.createElement("style", null, `
      @font-face{font-family:Audiowide;src:url('./assets/fonts/audiowide/Audiowide-Regular.woff2') format('woff2');font-display:swap}
      html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#f5f4ef;touch-action:none;overscroll-behavior:none}
       :root{--ui-unit:min(0.2564102564vw,0.1672240803vh)}
      *{box-sizing:border-box}button{font:inherit}.game-shell{position:relative;width:100%;height:100%;overflow:hidden;color:#303936;font-family:-apple-system,'Helvetica Neue',system-ui,sans-serif}
      canvas{display:block;width:100%;height:100%;touch-action:none}
      .top{position:absolute;left:calc(30 * var(--ui-unit) + env(safe-area-inset-left));right:calc(30 * var(--ui-unit) + env(safe-area-inset-right));top:calc(30 * var(--ui-unit) + env(safe-area-inset-top));pointer-events:none}
      .hud{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;font-size:calc(28 * var(--ui-unit));line-height:1.2;font-variant-numeric:tabular-nums}
      .hud span{display:flex;align-items:baseline;gap:7px}.hud small{font:600 calc(14 * var(--ui-unit))/1.3 system-ui,sans-serif;color:#777e76}
      .instruction,.bottom{position:absolute;left:calc(30 * var(--ui-unit) + env(safe-area-inset-left));right:calc(30 * var(--ui-unit) + env(safe-area-inset-right));text-align:center;font:500 calc(18 * var(--ui-unit))/1.4 system-ui,sans-serif;color:#555d55;pointer-events:none}
      .instruction{top:calc(30 * var(--ui-unit) + env(safe-area-inset-top))}.bottom{bottom:calc(50 * var(--ui-unit) + env(safe-area-inset-bottom))}
      button:focus-visible{outline:3px solid #fff;outline-offset:3px}

      .panel{position:absolute;inset:0;z-index:4;background:rgba(245,244,239,.9);display:flex;align-items:center;justify-content:center;padding:calc(30 * var(--ui-unit) + env(safe-area-inset-top)) calc(30 * var(--ui-unit)) calc(50 * var(--ui-unit) + env(safe-area-inset-bottom))}
      .card{text-align:center;width:100%;max-width:340px;padding:28px 20px;border:2px solid #c8cec4;border-radius:18px;background:#f5f4ef;box-shadow:none}
      .card h1{margin:0 0 16px;font-size:calc(24 * var(--ui-unit));color:#252627;line-height:1.15}.card p{margin:0 0 24px;font:600 18px/1.4 system-ui,sans-serif}.card button{min-height:52px;min-width:190px;border:2px solid #303936;border-radius:12px;color:#f5f4ef;background:#303936;padding:11px 20px;font-size:17px;cursor:pointer}.card button:active{filter:brightness(.8)}.card button.secondary{margin-top:12px;background:transparent;color:#303936}.card button:disabled{opacity:.55}
    `), ue.default.createElement("canvas", { ref: w, onPointerDown: U, onPointerMove: V2, onPointerUp: Y, onPointerCancel: $, "aria-label": "Draw a blade, then drag the dot character to fight enemies" }), ue.default.createElement("div", { className: "top" }, b === "playing" && ue.default.createElement("div", { className: "hud" }, ue.default.createElement("span", { "aria-label": "Knockouts " + k.score }, ue.default.createElement("small", null, "KOs"), k.score), ue.default.createElement("span", { "aria-label": "Health " + k.lives }, ue.default.createElement("small", null, "HP"), k.lives))), b === "drawing" && ue.default.createElement("div", { className: "instruction", style: { visibility: P.drawing ? "visible" : "hidden" }, "aria-hidden": !P.drawing }, "Draw a blade, then release to equip it"), b === "playing" && ue.default.createElement("div", { className: "bottom", style: { visibility: P.playing ? "visible" : "hidden" }, "aria-hidden": !P.playing }, "Drag to move. Your blade spins."), (b === "over" || b === "won") && ue.default.createElement("div", { className: "panel" }, ue.default.createElement("div", { className: "card" }, ue.default.createElement("h1", null, b === "won" ? "VICTORY!" : M?.TEXT_GAMEOVER || "GAME OVER"), ue.default.createElement("p", null, b === "won" ? "Your custom blade cleared the arena." : `KOs: ${k.score} \xB7 Draw a new blade and try again.`), ue.default.createElement("button", { onClick: z2 }, M?.BTN_RESTART || "PLAY AGAIN"), D && ue.default.createElement("button", { className: "secondary", disabled: W, onClick: j }, M?.BTN_POST || "Post My Play"))));
  }
  (0, bv.createRoot)(document.getElementById("root")).render(ue.default.createElement(RT, null));
})();
(function() {
  "use strict";
  const script = document.currentScript;
  const selector = ".top, #root canvas";
  const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let observer, animation, entered = false;
  function stop() {
    animation?.cancel();
    animation = null;
  }
  function enter() {
    if (entered || document.hidden) return;
    const subject = document.querySelector(selector);
    if (!subject || subject.closest('[hidden], [aria-hidden="true"]')) return;
    const computed = window.getComputedStyle(subject);
    if (computed.display === "none" || computed.visibility === "hidden") return;
    if (subject.tagName === "IMG" && !subject.complete) {
      subject.addEventListener("load", enter, { once: true });
      return;
    }
    entered = true;
    observer?.disconnect();
    if (media?.matches) return;
    const opacity = Number(window.getComputedStyle(subject).opacity) || 1;
    if (typeof subject.animate === "function") {
      animation = subject.animate([{ opacity: opacity * 0.76 }, { opacity }], { duration: 650, easing: "ease-out" });
      animation.onfinish = () => {
        animation = null;
      };
    }
  }
  observer = new MutationObserver(enter);
  observer.observe(document.body, { childList: true, subtree: true });
  enter();
  document.addEventListener("visibilitychange", () => {
    document.documentElement.toggleAttribute("data-feed-background", document.hidden);
    if (document.hidden) stop();
    else enter();
  });
  window.addEventListener("pagehide", () => {
    observer.disconnect();
    stop();
  });
  window.addEventListener("pageshow", () => {
    if (!entered) observer.observe(document.body, { childList: true, subtree: true });
    enter();
  });
  document.addEventListener("pointerdown", stop, { capture: true, passive: true });
  media?.addEventListener?.("change", () => {
    if (media.matches) stop();
  });
})();
/*! Bundled license information:

react/cjs/react.production.min.js:
  (**
   * @license React
   * react.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

scheduler/cjs/scheduler.production.min.js:
  (**
   * @license React
   * scheduler.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react-dom/cjs/react-dom.production.min.js:
  (**
   * @license React
   * react-dom.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

tone/build/esm/core/Tone.js:
  (**
   * Tone.js
   * @author Yotam Mann
   * @license http://opensource.org/licenses/MIT MIT License
   * @copyright 2014-2024 Yotam Mann
   *)
*/
