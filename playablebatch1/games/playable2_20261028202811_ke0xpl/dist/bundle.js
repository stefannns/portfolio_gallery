(()=>{var m_=Object.create;var Tm=Object.defineProperty;var g_=Object.getOwnPropertyDescriptor;var v_=Object.getOwnPropertyNames;var x_=Object.getPrototypeOf,y_=Object.prototype.hasOwnProperty;var Vi=(n,e)=>()=>(e||n((e={exports:{}}).exports,e),e.exports);var __=(n,e,t,i)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of v_(e))!y_.call(n,r)&&r!==t&&Tm(n,r,{get:()=>e[r],enumerable:!(i=g_(e,r))||i.enumerable});return n};var Th=(n,e,t)=>(t=n!=null?m_(x_(n)):{},__(e||!n||!n.__esModule?Tm(t,"default",{value:n,enumerable:!0}):t,n));var Om=Vi(Je=>{"use strict";var _o=Symbol.for("react.element"),S_=Symbol.for("react.portal"),M_=Symbol.for("react.fragment"),w_=Symbol.for("react.strict_mode"),E_=Symbol.for("react.profiler"),T_=Symbol.for("react.provider"),A_=Symbol.for("react.context"),b_=Symbol.for("react.forward_ref"),C_=Symbol.for("react.suspense"),R_=Symbol.for("react.memo"),P_=Symbol.for("react.lazy"),Am=Symbol.iterator;function I_(n){return n===null||typeof n!="object"?null:(n=Am&&n[Am]||n["@@iterator"],typeof n=="function"?n:null)}var Rm={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},Pm=Object.assign,Im={};function ls(n,e,t){this.props=n,this.context=e,this.refs=Im,this.updater=t||Rm}ls.prototype.isReactComponent={};ls.prototype.setState=function(n,e){if(typeof n!="object"&&typeof n!="function"&&n!=null)throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,n,e,"setState")};ls.prototype.forceUpdate=function(n){this.updater.enqueueForceUpdate(this,n,"forceUpdate")};function Lm(){}Lm.prototype=ls.prototype;function bh(n,e,t){this.props=n,this.context=e,this.refs=Im,this.updater=t||Rm}var Ch=bh.prototype=new Lm;Ch.constructor=bh;Pm(Ch,ls.prototype);Ch.isPureReactComponent=!0;var bm=Array.isArray,Dm=Object.prototype.hasOwnProperty,Rh={current:null},Nm={key:!0,ref:!0,__self:!0,__source:!0};function Um(n,e,t){var i,r={},s=null,o=null;if(e!=null)for(i in e.ref!==void 0&&(o=e.ref),e.key!==void 0&&(s=""+e.key),e)Dm.call(e,i)&&!Nm.hasOwnProperty(i)&&(r[i]=e[i]);var a=arguments.length-2;if(a===1)r.children=t;else if(1<a){for(var l=Array(a),u=0;u<a;u++)l[u]=arguments[u+2];r.children=l}if(n&&n.defaultProps)for(i in a=n.defaultProps,a)r[i]===void 0&&(r[i]=a[i]);return{$$typeof:_o,type:n,key:s,ref:o,props:r,_owner:Rh.current}}function L_(n,e){return{$$typeof:_o,type:n.type,key:e,ref:n.ref,props:n.props,_owner:n._owner}}function Ph(n){return typeof n=="object"&&n!==null&&n.$$typeof===_o}function D_(n){var e={"=":"=0",":":"=2"};return"$"+n.replace(/[=:]/g,function(t){return e[t]})}var Cm=/\/+/g;function Ah(n,e){return typeof n=="object"&&n!==null&&n.key!=null?D_(""+n.key):e.toString(36)}function ol(n,e,t,i,r){var s=typeof n;(s==="undefined"||s==="boolean")&&(n=null);var o=!1;if(n===null)o=!0;else switch(s){case"string":case"number":o=!0;break;case"object":switch(n.$$typeof){case _o:case S_:o=!0}}if(o)return o=n,r=r(o),n=i===""?"."+Ah(o,0):i,bm(r)?(t="",n!=null&&(t=n.replace(Cm,"$&/")+"/"),ol(r,e,t,"",function(u){return u})):r!=null&&(Ph(r)&&(r=L_(r,t+(!r.key||o&&o.key===r.key?"":(""+r.key).replace(Cm,"$&/")+"/")+n)),e.push(r)),1;if(o=0,i=i===""?".":i+":",bm(n))for(var a=0;a<n.length;a++){s=n[a];var l=i+Ah(s,a);o+=ol(s,e,t,l,r)}else if(l=I_(n),typeof l=="function")for(n=l.call(n),a=0;!(s=n.next()).done;)s=s.value,l=i+Ah(s,a++),o+=ol(s,e,t,l,r);else if(s==="object")throw e=String(n),Error("Objects are not valid as a React child (found: "+(e==="[object Object]"?"object with keys {"+Object.keys(n).join(", ")+"}":e)+"). If you meant to render a collection of children, use an array instead.");return o}function sl(n,e,t){if(n==null)return n;var i=[],r=0;return ol(n,i,"","",function(s){return e.call(t,s,r++)}),i}function N_(n){if(n._status===-1){var e=n._result;e=e(),e.then(function(t){(n._status===0||n._status===-1)&&(n._status=1,n._result=t)},function(t){(n._status===0||n._status===-1)&&(n._status=2,n._result=t)}),n._status===-1&&(n._status=0,n._result=e)}if(n._status===1)return n._result.default;throw n._result}var jt={current:null},al={transition:null},U_={ReactCurrentDispatcher:jt,ReactCurrentBatchConfig:al,ReactCurrentOwner:Rh};function Fm(){throw Error("act(...) is not supported in production builds of React.")}Je.Children={map:sl,forEach:function(n,e,t){sl(n,function(){e.apply(this,arguments)},t)},count:function(n){var e=0;return sl(n,function(){e++}),e},toArray:function(n){return sl(n,function(e){return e})||[]},only:function(n){if(!Ph(n))throw Error("React.Children.only expected to receive a single React element child.");return n}};Je.Component=ls;Je.Fragment=M_;Je.Profiler=E_;Je.PureComponent=bh;Je.StrictMode=w_;Je.Suspense=C_;Je.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=U_;Je.act=Fm;Je.cloneElement=function(n,e,t){if(n==null)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+n+".");var i=Pm({},n.props),r=n.key,s=n.ref,o=n._owner;if(e!=null){if(e.ref!==void 0&&(s=e.ref,o=Rh.current),e.key!==void 0&&(r=""+e.key),n.type&&n.type.defaultProps)var a=n.type.defaultProps;for(l in e)Dm.call(e,l)&&!Nm.hasOwnProperty(l)&&(i[l]=e[l]===void 0&&a!==void 0?a[l]:e[l])}var l=arguments.length-2;if(l===1)i.children=t;else if(1<l){a=Array(l);for(var u=0;u<l;u++)a[u]=arguments[u+2];i.children=a}return{$$typeof:_o,type:n.type,key:r,ref:s,props:i,_owner:o}};Je.createContext=function(n){return n={$$typeof:A_,_currentValue:n,_currentValue2:n,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},n.Provider={$$typeof:T_,_context:n},n.Consumer=n};Je.createElement=Um;Je.createFactory=function(n){var e=Um.bind(null,n);return e.type=n,e};Je.createRef=function(){return{current:null}};Je.forwardRef=function(n){return{$$typeof:b_,render:n}};Je.isValidElement=Ph;Je.lazy=function(n){return{$$typeof:P_,_payload:{_status:-1,_result:n},_init:N_}};Je.memo=function(n,e){return{$$typeof:R_,type:n,compare:e===void 0?null:e}};Je.startTransition=function(n){var e=al.transition;al.transition={};try{n()}finally{al.transition=e}};Je.unstable_act=Fm;Je.useCallback=function(n,e){return jt.current.useCallback(n,e)};Je.useContext=function(n){return jt.current.useContext(n)};Je.useDebugValue=function(){};Je.useDeferredValue=function(n){return jt.current.useDeferredValue(n)};Je.useEffect=function(n,e){return jt.current.useEffect(n,e)};Je.useId=function(){return jt.current.useId()};Je.useImperativeHandle=function(n,e,t){return jt.current.useImperativeHandle(n,e,t)};Je.useInsertionEffect=function(n,e){return jt.current.useInsertionEffect(n,e)};Je.useLayoutEffect=function(n,e){return jt.current.useLayoutEffect(n,e)};Je.useMemo=function(n,e){return jt.current.useMemo(n,e)};Je.useReducer=function(n,e,t){return jt.current.useReducer(n,e,t)};Je.useRef=function(n){return jt.current.useRef(n)};Je.useState=function(n){return jt.current.useState(n)};Je.useSyncExternalStore=function(n,e,t){return jt.current.useSyncExternalStore(n,e,t)};Je.useTransition=function(){return jt.current.useTransition()};Je.version="18.3.1"});var Ih=Vi((Ub,Bm)=>{"use strict";Bm.exports=Om()});var $m=Vi(ct=>{"use strict";function Uh(n,e){var t=n.length;n.push(e);e:for(;0<t;){var i=t-1>>>1,r=n[i];if(0<ll(r,e))n[i]=e,n[t]=r,t=i;else break e}}function Vn(n){return n.length===0?null:n[0]}function ul(n){if(n.length===0)return null;var e=n[0],t=n.pop();if(t!==e){n[0]=t;e:for(var i=0,r=n.length,s=r>>>1;i<s;){var o=2*(i+1)-1,a=n[o],l=o+1,u=n[l];if(0>ll(a,t))l<r&&0>ll(u,a)?(n[i]=u,n[l]=t,i=l):(n[i]=a,n[o]=t,i=o);else if(l<r&&0>ll(u,t))n[i]=u,n[l]=t,i=l;else break e}}return e}function ll(n,e){var t=n.sortIndex-e.sortIndex;return t!==0?t:n.id-e.id}typeof performance=="object"&&typeof performance.now=="function"?(km=performance,ct.unstable_now=function(){return km.now()}):(Lh=Date,zm=Lh.now(),ct.unstable_now=function(){return Lh.now()-zm});var km,Lh,zm,si=[],Hi=[],F_=1,Pn=null,zt=3,hl=!1,Tr=!1,Mo=!1,Gm=typeof setTimeout=="function"?setTimeout:null,Wm=typeof clearTimeout=="function"?clearTimeout:null,Vm=typeof setImmediate<"u"?setImmediate:null;typeof navigator<"u"&&navigator.scheduling!==void 0&&navigator.scheduling.isInputPending!==void 0&&navigator.scheduling.isInputPending.bind(navigator.scheduling);function Fh(n){for(var e=Vn(Hi);e!==null;){if(e.callback===null)ul(Hi);else if(e.startTime<=n)ul(Hi),e.sortIndex=e.expirationTime,Uh(si,e);else break;e=Vn(Hi)}}function Oh(n){if(Mo=!1,Fh(n),!Tr)if(Vn(si)!==null)Tr=!0,kh(Bh);else{var e=Vn(Hi);e!==null&&zh(Oh,e.startTime-n)}}function Bh(n,e){Tr=!1,Mo&&(Mo=!1,Wm(wo),wo=-1),hl=!0;var t=zt;try{for(Fh(e),Pn=Vn(si);Pn!==null&&(!(Pn.expirationTime>e)||n&&!qm());){var i=Pn.callback;if(typeof i=="function"){Pn.callback=null,zt=Pn.priorityLevel;var r=i(Pn.expirationTime<=e);e=ct.unstable_now(),typeof r=="function"?Pn.callback=r:Pn===Vn(si)&&ul(si),Fh(e)}else ul(si);Pn=Vn(si)}if(Pn!==null)var s=!0;else{var o=Vn(Hi);o!==null&&zh(Oh,o.startTime-e),s=!1}return s}finally{Pn=null,zt=t,hl=!1}}var fl=!1,cl=null,wo=-1,Xm=5,Ym=-1;function qm(){return!(ct.unstable_now()-Ym<Xm)}function Dh(){if(cl!==null){var n=ct.unstable_now();Ym=n;var e=!0;try{e=cl(!0,n)}finally{e?So():(fl=!1,cl=null)}}else fl=!1}var So;typeof Vm=="function"?So=function(){Vm(Dh)}:typeof MessageChannel<"u"?(Nh=new MessageChannel,Hm=Nh.port2,Nh.port1.onmessage=Dh,So=function(){Hm.postMessage(null)}):So=function(){Gm(Dh,0)};var Nh,Hm;function kh(n){cl=n,fl||(fl=!0,So())}function zh(n,e){wo=Gm(function(){n(ct.unstable_now())},e)}ct.unstable_IdlePriority=5;ct.unstable_ImmediatePriority=1;ct.unstable_LowPriority=4;ct.unstable_NormalPriority=3;ct.unstable_Profiling=null;ct.unstable_UserBlockingPriority=2;ct.unstable_cancelCallback=function(n){n.callback=null};ct.unstable_continueExecution=function(){Tr||hl||(Tr=!0,kh(Bh))};ct.unstable_forceFrameRate=function(n){0>n||125<n?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):Xm=0<n?Math.floor(1e3/n):5};ct.unstable_getCurrentPriorityLevel=function(){return zt};ct.unstable_getFirstCallbackNode=function(){return Vn(si)};ct.unstable_next=function(n){switch(zt){case 1:case 2:case 3:var e=3;break;default:e=zt}var t=zt;zt=e;try{return n()}finally{zt=t}};ct.unstable_pauseExecution=function(){};ct.unstable_requestPaint=function(){};ct.unstable_runWithPriority=function(n,e){switch(n){case 1:case 2:case 3:case 4:case 5:break;default:n=3}var t=zt;zt=n;try{return e()}finally{zt=t}};ct.unstable_scheduleCallback=function(n,e,t){var i=ct.unstable_now();switch(typeof t=="object"&&t!==null?(t=t.delay,t=typeof t=="number"&&0<t?i+t:i):t=i,n){case 1:var r=-1;break;case 2:r=250;break;case 5:r=1073741823;break;case 4:r=1e4;break;default:r=5e3}return r=t+r,n={id:F_++,callback:e,priorityLevel:n,startTime:t,expirationTime:r,sortIndex:-1},t>i?(n.sortIndex=t,Uh(Hi,n),Vn(si)===null&&n===Vn(Hi)&&(Mo?(Wm(wo),wo=-1):Mo=!0,zh(Oh,t-i))):(n.sortIndex=r,Uh(si,n),Tr||hl||(Tr=!0,kh(Bh))),n};ct.unstable_shouldYield=qm;ct.unstable_wrapCallback=function(n){var e=zt;return function(){var t=zt;zt=e;try{return n.apply(this,arguments)}finally{zt=t}}}});var Jm=Vi((Ob,Zm)=>{"use strict";Zm.exports=$m()});var ex=Vi(Mn=>{"use strict";var O_=Ih(),_n=Jm();function ce(n){for(var e="https://reactjs.org/docs/error-decoder.html?invariant="+n,t=1;t<arguments.length;t++)e+="&args[]="+encodeURIComponent(arguments[t]);return"Minified React error #"+n+"; visit "+e+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}var i0=new Set,Xo={};function Br(n,e){Rs(n,e),Rs(n+"Capture",e)}function Rs(n,e){for(Xo[n]=e,n=0;n<e.length;n++)i0.add(e[n])}var Mi=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),uf=Object.prototype.hasOwnProperty,B_=/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,Km={},Qm={};function k_(n){return uf.call(Qm,n)?!0:uf.call(Km,n)?!1:B_.test(n)?Qm[n]=!0:(Km[n]=!0,!1)}function z_(n,e,t,i){if(t!==null&&t.type===0)return!1;switch(typeof e){case"function":case"symbol":return!0;case"boolean":return i?!1:t!==null?!t.acceptsBooleans:(n=n.toLowerCase().slice(0,5),n!=="data-"&&n!=="aria-");default:return!1}}function V_(n,e,t,i){if(e===null||typeof e>"u"||z_(n,e,t,i))return!0;if(i)return!1;if(t!==null)switch(t.type){case 3:return!e;case 4:return e===!1;case 5:return isNaN(e);case 6:return isNaN(e)||1>e}return!1}function nn(n,e,t,i,r,s,o){this.acceptsBooleans=e===2||e===3||e===4,this.attributeName=i,this.attributeNamespace=r,this.mustUseProperty=t,this.propertyName=n,this.type=e,this.sanitizeURL=s,this.removeEmptyString=o}var kt={};"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(n){kt[n]=new nn(n,0,!1,n,null,!1,!1)});[["acceptCharset","accept-charset"],["className","class"],["htmlFor","for"],["httpEquiv","http-equiv"]].forEach(function(n){var e=n[0];kt[e]=new nn(e,1,!1,n[1],null,!1,!1)});["contentEditable","draggable","spellCheck","value"].forEach(function(n){kt[n]=new nn(n,2,!1,n.toLowerCase(),null,!1,!1)});["autoReverse","externalResourcesRequired","focusable","preserveAlpha"].forEach(function(n){kt[n]=new nn(n,2,!1,n,null,!1,!1)});"allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(n){kt[n]=new nn(n,3,!1,n.toLowerCase(),null,!1,!1)});["checked","multiple","muted","selected"].forEach(function(n){kt[n]=new nn(n,3,!0,n,null,!1,!1)});["capture","download"].forEach(function(n){kt[n]=new nn(n,4,!1,n,null,!1,!1)});["cols","rows","size","span"].forEach(function(n){kt[n]=new nn(n,6,!1,n,null,!1,!1)});["rowSpan","start"].forEach(function(n){kt[n]=new nn(n,5,!1,n.toLowerCase(),null,!1,!1)});var nd=/[\-:]([a-z])/g;function id(n){return n[1].toUpperCase()}"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(n){var e=n.replace(nd,id);kt[e]=new nn(e,1,!1,n,null,!1,!1)});"xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(n){var e=n.replace(nd,id);kt[e]=new nn(e,1,!1,n,"http://www.w3.org/1999/xlink",!1,!1)});["xml:base","xml:lang","xml:space"].forEach(function(n){var e=n.replace(nd,id);kt[e]=new nn(e,1,!1,n,"http://www.w3.org/XML/1998/namespace",!1,!1)});["tabIndex","crossOrigin"].forEach(function(n){kt[n]=new nn(n,1,!1,n.toLowerCase(),null,!1,!1)});kt.xlinkHref=new nn("xlinkHref",1,!1,"xlink:href","http://www.w3.org/1999/xlink",!0,!1);["src","href","action","formAction"].forEach(function(n){kt[n]=new nn(n,1,!1,n.toLowerCase(),null,!0,!0)});function rd(n,e,t,i){var r=kt.hasOwnProperty(e)?kt[e]:null;(r!==null?r.type!==0:i||!(2<e.length)||e[0]!=="o"&&e[0]!=="O"||e[1]!=="n"&&e[1]!=="N")&&(V_(e,t,r,i)&&(t=null),i||r===null?k_(e)&&(t===null?n.removeAttribute(e):n.setAttribute(e,""+t)):r.mustUseProperty?n[r.propertyName]=t===null?r.type===3?!1:"":t:(e=r.attributeName,i=r.attributeNamespace,t===null?n.removeAttribute(e):(r=r.type,t=r===3||r===4&&t===!0?"":""+t,i?n.setAttributeNS(i,e,t):n.setAttribute(e,t))))}var Ai=O_.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,dl=Symbol.for("react.element"),hs=Symbol.for("react.portal"),fs=Symbol.for("react.fragment"),sd=Symbol.for("react.strict_mode"),hf=Symbol.for("react.profiler"),r0=Symbol.for("react.provider"),s0=Symbol.for("react.context"),od=Symbol.for("react.forward_ref"),ff=Symbol.for("react.suspense"),df=Symbol.for("react.suspense_list"),ad=Symbol.for("react.memo"),Wi=Symbol.for("react.lazy");Symbol.for("react.scope");Symbol.for("react.debug_trace_mode");var o0=Symbol.for("react.offscreen");Symbol.for("react.legacy_hidden");Symbol.for("react.cache");Symbol.for("react.tracing_marker");var jm=Symbol.iterator;function Eo(n){return n===null||typeof n!="object"?null:(n=jm&&n[jm]||n["@@iterator"],typeof n=="function"?n:null)}var _t=Object.assign,Vh;function Lo(n){if(Vh===void 0)try{throw Error()}catch(t){var e=t.stack.trim().match(/\n( *(at )?)/);Vh=e&&e[1]||""}return`
`+Vh+n}var Hh=!1;function Gh(n,e){if(!n||Hh)return"";Hh=!0;var t=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{if(e)if(e=function(){throw Error()},Object.defineProperty(e.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(e,[])}catch(u){var i=u}Reflect.construct(n,[],e)}else{try{e.call()}catch(u){i=u}n.call(e.prototype)}else{try{throw Error()}catch(u){i=u}n()}}catch(u){if(u&&i&&typeof u.stack=="string"){for(var r=u.stack.split(`
`),s=i.stack.split(`
`),o=r.length-1,a=s.length-1;1<=o&&0<=a&&r[o]!==s[a];)a--;for(;1<=o&&0<=a;o--,a--)if(r[o]!==s[a]){if(o!==1||a!==1)do if(o--,a--,0>a||r[o]!==s[a]){var l=`
`+r[o].replace(" at new "," at ");return n.displayName&&l.includes("<anonymous>")&&(l=l.replace("<anonymous>",n.displayName)),l}while(1<=o&&0<=a);break}}}finally{Hh=!1,Error.prepareStackTrace=t}return(n=n?n.displayName||n.name:"")?Lo(n):""}function H_(n){switch(n.tag){case 5:return Lo(n.type);case 16:return Lo("Lazy");case 13:return Lo("Suspense");case 19:return Lo("SuspenseList");case 0:case 2:case 15:return n=Gh(n.type,!1),n;case 11:return n=Gh(n.type.render,!1),n;case 1:return n=Gh(n.type,!0),n;default:return""}}function pf(n){if(n==null)return null;if(typeof n=="function")return n.displayName||n.name||null;if(typeof n=="string")return n;switch(n){case fs:return"Fragment";case hs:return"Portal";case hf:return"Profiler";case sd:return"StrictMode";case ff:return"Suspense";case df:return"SuspenseList"}if(typeof n=="object")switch(n.$$typeof){case s0:return(n.displayName||"Context")+".Consumer";case r0:return(n._context.displayName||"Context")+".Provider";case od:var e=n.render;return n=n.displayName,n||(n=e.displayName||e.name||"",n=n!==""?"ForwardRef("+n+")":"ForwardRef"),n;case ad:return e=n.displayName||null,e!==null?e:pf(n.type)||"Memo";case Wi:e=n._payload,n=n._init;try{return pf(n(e))}catch{}}return null}function G_(n){var e=n.type;switch(n.tag){case 24:return"Cache";case 9:return(e.displayName||"Context")+".Consumer";case 10:return(e._context.displayName||"Context")+".Provider";case 18:return"DehydratedFragment";case 11:return n=e.render,n=n.displayName||n.name||"",e.displayName||(n!==""?"ForwardRef("+n+")":"ForwardRef");case 7:return"Fragment";case 5:return e;case 4:return"Portal";case 3:return"Root";case 6:return"Text";case 16:return pf(e);case 8:return e===sd?"StrictMode":"Mode";case 22:return"Offscreen";case 12:return"Profiler";case 21:return"Scope";case 13:return"Suspense";case 19:return"SuspenseList";case 25:return"TracingMarker";case 1:case 0:case 17:case 2:case 14:case 15:if(typeof e=="function")return e.displayName||e.name||null;if(typeof e=="string")return e}return null}function rr(n){switch(typeof n){case"boolean":case"number":case"string":case"undefined":return n;case"object":return n;default:return""}}function a0(n){var e=n.type;return(n=n.nodeName)&&n.toLowerCase()==="input"&&(e==="checkbox"||e==="radio")}function W_(n){var e=a0(n)?"checked":"value",t=Object.getOwnPropertyDescriptor(n.constructor.prototype,e),i=""+n[e];if(!n.hasOwnProperty(e)&&typeof t<"u"&&typeof t.get=="function"&&typeof t.set=="function"){var r=t.get,s=t.set;return Object.defineProperty(n,e,{configurable:!0,get:function(){return r.call(this)},set:function(o){i=""+o,s.call(this,o)}}),Object.defineProperty(n,e,{enumerable:t.enumerable}),{getValue:function(){return i},setValue:function(o){i=""+o},stopTracking:function(){n._valueTracker=null,delete n[e]}}}}function pl(n){n._valueTracker||(n._valueTracker=W_(n))}function l0(n){if(!n)return!1;var e=n._valueTracker;if(!e)return!0;var t=e.getValue(),i="";return n&&(i=a0(n)?n.checked?"true":"false":n.value),n=i,n!==t?(e.setValue(n),!0):!1}function Hl(n){if(n=n||(typeof document<"u"?document:void 0),typeof n>"u")return null;try{return n.activeElement||n.body}catch{return n.body}}function mf(n,e){var t=e.checked;return _t({},e,{defaultChecked:void 0,defaultValue:void 0,value:void 0,checked:t??n._wrapperState.initialChecked})}function eg(n,e){var t=e.defaultValue==null?"":e.defaultValue,i=e.checked!=null?e.checked:e.defaultChecked;t=rr(e.value!=null?e.value:t),n._wrapperState={initialChecked:i,initialValue:t,controlled:e.type==="checkbox"||e.type==="radio"?e.checked!=null:e.value!=null}}function c0(n,e){e=e.checked,e!=null&&rd(n,"checked",e,!1)}function gf(n,e){c0(n,e);var t=rr(e.value),i=e.type;if(t!=null)i==="number"?(t===0&&n.value===""||n.value!=t)&&(n.value=""+t):n.value!==""+t&&(n.value=""+t);else if(i==="submit"||i==="reset"){n.removeAttribute("value");return}e.hasOwnProperty("value")?vf(n,e.type,t):e.hasOwnProperty("defaultValue")&&vf(n,e.type,rr(e.defaultValue)),e.checked==null&&e.defaultChecked!=null&&(n.defaultChecked=!!e.defaultChecked)}function tg(n,e,t){if(e.hasOwnProperty("value")||e.hasOwnProperty("defaultValue")){var i=e.type;if(!(i!=="submit"&&i!=="reset"||e.value!==void 0&&e.value!==null))return;e=""+n._wrapperState.initialValue,t||e===n.value||(n.value=e),n.defaultValue=e}t=n.name,t!==""&&(n.name=""),n.defaultChecked=!!n._wrapperState.initialChecked,t!==""&&(n.name=t)}function vf(n,e,t){(e!=="number"||Hl(n.ownerDocument)!==n)&&(t==null?n.defaultValue=""+n._wrapperState.initialValue:n.defaultValue!==""+t&&(n.defaultValue=""+t))}var Do=Array.isArray;function ws(n,e,t,i){if(n=n.options,e){e={};for(var r=0;r<t.length;r++)e["$"+t[r]]=!0;for(t=0;t<n.length;t++)r=e.hasOwnProperty("$"+n[t].value),n[t].selected!==r&&(n[t].selected=r),r&&i&&(n[t].defaultSelected=!0)}else{for(t=""+rr(t),e=null,r=0;r<n.length;r++){if(n[r].value===t){n[r].selected=!0,i&&(n[r].defaultSelected=!0);return}e!==null||n[r].disabled||(e=n[r])}e!==null&&(e.selected=!0)}}function xf(n,e){if(e.dangerouslySetInnerHTML!=null)throw Error(ce(91));return _t({},e,{value:void 0,defaultValue:void 0,children:""+n._wrapperState.initialValue})}function ng(n,e){var t=e.value;if(t==null){if(t=e.children,e=e.defaultValue,t!=null){if(e!=null)throw Error(ce(92));if(Do(t)){if(1<t.length)throw Error(ce(93));t=t[0]}e=t}e==null&&(e=""),t=e}n._wrapperState={initialValue:rr(t)}}function u0(n,e){var t=rr(e.value),i=rr(e.defaultValue);t!=null&&(t=""+t,t!==n.value&&(n.value=t),e.defaultValue==null&&n.defaultValue!==t&&(n.defaultValue=t)),i!=null&&(n.defaultValue=""+i)}function ig(n){var e=n.textContent;e===n._wrapperState.initialValue&&e!==""&&e!==null&&(n.value=e)}function h0(n){switch(n){case"svg":return"http://www.w3.org/2000/svg";case"math":return"http://www.w3.org/1998/Math/MathML";default:return"http://www.w3.org/1999/xhtml"}}function yf(n,e){return n==null||n==="http://www.w3.org/1999/xhtml"?h0(e):n==="http://www.w3.org/2000/svg"&&e==="foreignObject"?"http://www.w3.org/1999/xhtml":n}var ml,f0=(function(n){return typeof MSApp<"u"&&MSApp.execUnsafeLocalFunction?function(e,t,i,r){MSApp.execUnsafeLocalFunction(function(){return n(e,t,i,r)})}:n})(function(n,e){if(n.namespaceURI!=="http://www.w3.org/2000/svg"||"innerHTML"in n)n.innerHTML=e;else{for(ml=ml||document.createElement("div"),ml.innerHTML="<svg>"+e.valueOf().toString()+"</svg>",e=ml.firstChild;n.firstChild;)n.removeChild(n.firstChild);for(;e.firstChild;)n.appendChild(e.firstChild)}});function Yo(n,e){if(e){var t=n.firstChild;if(t&&t===n.lastChild&&t.nodeType===3){t.nodeValue=e;return}}n.textContent=e}var Fo={animationIterationCount:!0,aspectRatio:!0,borderImageOutset:!0,borderImageSlice:!0,borderImageWidth:!0,boxFlex:!0,boxFlexGroup:!0,boxOrdinalGroup:!0,columnCount:!0,columns:!0,flex:!0,flexGrow:!0,flexPositive:!0,flexShrink:!0,flexNegative:!0,flexOrder:!0,gridArea:!0,gridRow:!0,gridRowEnd:!0,gridRowSpan:!0,gridRowStart:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnSpan:!0,gridColumnStart:!0,fontWeight:!0,lineClamp:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,tabSize:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeDasharray:!0,strokeDashoffset:!0,strokeMiterlimit:!0,strokeOpacity:!0,strokeWidth:!0},X_=["Webkit","ms","Moz","O"];Object.keys(Fo).forEach(function(n){X_.forEach(function(e){e=e+n.charAt(0).toUpperCase()+n.substring(1),Fo[e]=Fo[n]})});function d0(n,e,t){return e==null||typeof e=="boolean"||e===""?"":t||typeof e!="number"||e===0||Fo.hasOwnProperty(n)&&Fo[n]?(""+e).trim():e+"px"}function p0(n,e){n=n.style;for(var t in e)if(e.hasOwnProperty(t)){var i=t.indexOf("--")===0,r=d0(t,e[t],i);t==="float"&&(t="cssFloat"),i?n.setProperty(t,r):n[t]=r}}var Y_=_t({menuitem:!0},{area:!0,base:!0,br:!0,col:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0});function _f(n,e){if(e){if(Y_[n]&&(e.children!=null||e.dangerouslySetInnerHTML!=null))throw Error(ce(137,n));if(e.dangerouslySetInnerHTML!=null){if(e.children!=null)throw Error(ce(60));if(typeof e.dangerouslySetInnerHTML!="object"||!("__html"in e.dangerouslySetInnerHTML))throw Error(ce(61))}if(e.style!=null&&typeof e.style!="object")throw Error(ce(62))}}function Sf(n,e){if(n.indexOf("-")===-1)return typeof e.is=="string";switch(n){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var Mf=null;function ld(n){return n=n.target||n.srcElement||window,n.correspondingUseElement&&(n=n.correspondingUseElement),n.nodeType===3?n.parentNode:n}var wf=null,Es=null,Ts=null;function rg(n){if(n=ua(n)){if(typeof wf!="function")throw Error(ce(280));var e=n.stateNode;e&&(e=gc(e),wf(n.stateNode,n.type,e))}}function m0(n){Es?Ts?Ts.push(n):Ts=[n]:Es=n}function g0(){if(Es){var n=Es,e=Ts;if(Ts=Es=null,rg(n),e)for(n=0;n<e.length;n++)rg(e[n])}}function v0(n,e){return n(e)}function x0(){}var Wh=!1;function y0(n,e,t){if(Wh)return n(e,t);Wh=!0;try{return v0(n,e,t)}finally{Wh=!1,(Es!==null||Ts!==null)&&(x0(),g0())}}function qo(n,e){var t=n.stateNode;if(t===null)return null;var i=gc(t);if(i===null)return null;t=i[e];e:switch(e){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(i=!i.disabled)||(n=n.type,i=!(n==="button"||n==="input"||n==="select"||n==="textarea")),n=!i;break e;default:n=!1}if(n)return null;if(t&&typeof t!="function")throw Error(ce(231,e,typeof t));return t}var Ef=!1;if(Mi)try{cs={},Object.defineProperty(cs,"passive",{get:function(){Ef=!0}}),window.addEventListener("test",cs,cs),window.removeEventListener("test",cs,cs)}catch{Ef=!1}var cs;function q_(n,e,t,i,r,s,o,a,l){var u=Array.prototype.slice.call(arguments,3);try{e.apply(t,u)}catch(h){this.onError(h)}}var Oo=!1,Gl=null,Wl=!1,Tf=null,$_={onError:function(n){Oo=!0,Gl=n}};function Z_(n,e,t,i,r,s,o,a,l){Oo=!1,Gl=null,q_.apply($_,arguments)}function J_(n,e,t,i,r,s,o,a,l){if(Z_.apply(this,arguments),Oo){if(Oo){var u=Gl;Oo=!1,Gl=null}else throw Error(ce(198));Wl||(Wl=!0,Tf=u)}}function kr(n){var e=n,t=n;if(n.alternate)for(;e.return;)e=e.return;else{n=e;do e=n,(e.flags&4098)!==0&&(t=e.return),n=e.return;while(n)}return e.tag===3?t:null}function _0(n){if(n.tag===13){var e=n.memoizedState;if(e===null&&(n=n.alternate,n!==null&&(e=n.memoizedState)),e!==null)return e.dehydrated}return null}function sg(n){if(kr(n)!==n)throw Error(ce(188))}function K_(n){var e=n.alternate;if(!e){if(e=kr(n),e===null)throw Error(ce(188));return e!==n?null:n}for(var t=n,i=e;;){var r=t.return;if(r===null)break;var s=r.alternate;if(s===null){if(i=r.return,i!==null){t=i;continue}break}if(r.child===s.child){for(s=r.child;s;){if(s===t)return sg(r),n;if(s===i)return sg(r),e;s=s.sibling}throw Error(ce(188))}if(t.return!==i.return)t=r,i=s;else{for(var o=!1,a=r.child;a;){if(a===t){o=!0,t=r,i=s;break}if(a===i){o=!0,i=r,t=s;break}a=a.sibling}if(!o){for(a=s.child;a;){if(a===t){o=!0,t=s,i=r;break}if(a===i){o=!0,i=s,t=r;break}a=a.sibling}if(!o)throw Error(ce(189))}}if(t.alternate!==i)throw Error(ce(190))}if(t.tag!==3)throw Error(ce(188));return t.stateNode.current===t?n:e}function S0(n){return n=K_(n),n!==null?M0(n):null}function M0(n){if(n.tag===5||n.tag===6)return n;for(n=n.child;n!==null;){var e=M0(n);if(e!==null)return e;n=n.sibling}return null}var w0=_n.unstable_scheduleCallback,og=_n.unstable_cancelCallback,Q_=_n.unstable_shouldYield,j_=_n.unstable_requestPaint,At=_n.unstable_now,eS=_n.unstable_getCurrentPriorityLevel,cd=_n.unstable_ImmediatePriority,E0=_n.unstable_UserBlockingPriority,Xl=_n.unstable_NormalPriority,tS=_n.unstable_LowPriority,T0=_n.unstable_IdlePriority,fc=null,ci=null;function nS(n){if(ci&&typeof ci.onCommitFiberRoot=="function")try{ci.onCommitFiberRoot(fc,n,void 0,(n.current.flags&128)===128)}catch{}}var Yn=Math.clz32?Math.clz32:sS,iS=Math.log,rS=Math.LN2;function sS(n){return n>>>=0,n===0?32:31-(iS(n)/rS|0)|0}var gl=64,vl=4194304;function No(n){switch(n&-n){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return n&4194240;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return n&130023424;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 1073741824;default:return n}}function Yl(n,e){var t=n.pendingLanes;if(t===0)return 0;var i=0,r=n.suspendedLanes,s=n.pingedLanes,o=t&268435455;if(o!==0){var a=o&~r;a!==0?i=No(a):(s&=o,s!==0&&(i=No(s)))}else o=t&~r,o!==0?i=No(o):s!==0&&(i=No(s));if(i===0)return 0;if(e!==0&&e!==i&&(e&r)===0&&(r=i&-i,s=e&-e,r>=s||r===16&&(s&4194240)!==0))return e;if((i&4)!==0&&(i|=t&16),e=n.entangledLanes,e!==0)for(n=n.entanglements,e&=i;0<e;)t=31-Yn(e),r=1<<t,i|=n[t],e&=~r;return i}function oS(n,e){switch(n){case 1:case 2:case 4:return e+250;case 8:case 16:case 32:case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return e+5e3;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return-1;case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function aS(n,e){for(var t=n.suspendedLanes,i=n.pingedLanes,r=n.expirationTimes,s=n.pendingLanes;0<s;){var o=31-Yn(s),a=1<<o,l=r[o];l===-1?((a&t)===0||(a&i)!==0)&&(r[o]=oS(a,e)):l<=e&&(n.expiredLanes|=a),s&=~a}}function Af(n){return n=n.pendingLanes&-1073741825,n!==0?n:n&1073741824?1073741824:0}function A0(){var n=gl;return gl<<=1,(gl&4194240)===0&&(gl=64),n}function Xh(n){for(var e=[],t=0;31>t;t++)e.push(n);return e}function la(n,e,t){n.pendingLanes|=e,e!==536870912&&(n.suspendedLanes=0,n.pingedLanes=0),n=n.eventTimes,e=31-Yn(e),n[e]=t}function lS(n,e){var t=n.pendingLanes&~e;n.pendingLanes=e,n.suspendedLanes=0,n.pingedLanes=0,n.expiredLanes&=e,n.mutableReadLanes&=e,n.entangledLanes&=e,e=n.entanglements;var i=n.eventTimes;for(n=n.expirationTimes;0<t;){var r=31-Yn(t),s=1<<r;e[r]=0,i[r]=-1,n[r]=-1,t&=~s}}function ud(n,e){var t=n.entangledLanes|=e;for(n=n.entanglements;t;){var i=31-Yn(t),r=1<<i;r&e|n[i]&e&&(n[i]|=e),t&=~r}}var rt=0;function b0(n){return n&=-n,1<n?4<n?(n&268435455)!==0?16:536870912:4:1}var C0,hd,R0,P0,I0,bf=!1,xl=[],Ji=null,Ki=null,Qi=null,$o=new Map,Zo=new Map,Yi=[],cS="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");function ag(n,e){switch(n){case"focusin":case"focusout":Ji=null;break;case"dragenter":case"dragleave":Ki=null;break;case"mouseover":case"mouseout":Qi=null;break;case"pointerover":case"pointerout":$o.delete(e.pointerId);break;case"gotpointercapture":case"lostpointercapture":Zo.delete(e.pointerId)}}function To(n,e,t,i,r,s){return n===null||n.nativeEvent!==s?(n={blockedOn:e,domEventName:t,eventSystemFlags:i,nativeEvent:s,targetContainers:[r]},e!==null&&(e=ua(e),e!==null&&hd(e)),n):(n.eventSystemFlags|=i,e=n.targetContainers,r!==null&&e.indexOf(r)===-1&&e.push(r),n)}function uS(n,e,t,i,r){switch(e){case"focusin":return Ji=To(Ji,n,e,t,i,r),!0;case"dragenter":return Ki=To(Ki,n,e,t,i,r),!0;case"mouseover":return Qi=To(Qi,n,e,t,i,r),!0;case"pointerover":var s=r.pointerId;return $o.set(s,To($o.get(s)||null,n,e,t,i,r)),!0;case"gotpointercapture":return s=r.pointerId,Zo.set(s,To(Zo.get(s)||null,n,e,t,i,r)),!0}return!1}function L0(n){var e=Cr(n.target);if(e!==null){var t=kr(e);if(t!==null){if(e=t.tag,e===13){if(e=_0(t),e!==null){n.blockedOn=e,I0(n.priority,function(){R0(t)});return}}else if(e===3&&t.stateNode.current.memoizedState.isDehydrated){n.blockedOn=t.tag===3?t.stateNode.containerInfo:null;return}}}n.blockedOn=null}function Ll(n){if(n.blockedOn!==null)return!1;for(var e=n.targetContainers;0<e.length;){var t=Cf(n.domEventName,n.eventSystemFlags,e[0],n.nativeEvent);if(t===null){t=n.nativeEvent;var i=new t.constructor(t.type,t);Mf=i,t.target.dispatchEvent(i),Mf=null}else return e=ua(t),e!==null&&hd(e),n.blockedOn=t,!1;e.shift()}return!0}function lg(n,e,t){Ll(n)&&t.delete(e)}function hS(){bf=!1,Ji!==null&&Ll(Ji)&&(Ji=null),Ki!==null&&Ll(Ki)&&(Ki=null),Qi!==null&&Ll(Qi)&&(Qi=null),$o.forEach(lg),Zo.forEach(lg)}function Ao(n,e){n.blockedOn===e&&(n.blockedOn=null,bf||(bf=!0,_n.unstable_scheduleCallback(_n.unstable_NormalPriority,hS)))}function Jo(n){function e(r){return Ao(r,n)}if(0<xl.length){Ao(xl[0],n);for(var t=1;t<xl.length;t++){var i=xl[t];i.blockedOn===n&&(i.blockedOn=null)}}for(Ji!==null&&Ao(Ji,n),Ki!==null&&Ao(Ki,n),Qi!==null&&Ao(Qi,n),$o.forEach(e),Zo.forEach(e),t=0;t<Yi.length;t++)i=Yi[t],i.blockedOn===n&&(i.blockedOn=null);for(;0<Yi.length&&(t=Yi[0],t.blockedOn===null);)L0(t),t.blockedOn===null&&Yi.shift()}var As=Ai.ReactCurrentBatchConfig,ql=!0;function fS(n,e,t,i){var r=rt,s=As.transition;As.transition=null;try{rt=1,fd(n,e,t,i)}finally{rt=r,As.transition=s}}function dS(n,e,t,i){var r=rt,s=As.transition;As.transition=null;try{rt=4,fd(n,e,t,i)}finally{rt=r,As.transition=s}}function fd(n,e,t,i){if(ql){var r=Cf(n,e,t,i);if(r===null)Qh(n,e,i,$l,t),ag(n,i);else if(uS(r,n,e,t,i))i.stopPropagation();else if(ag(n,i),e&4&&-1<cS.indexOf(n)){for(;r!==null;){var s=ua(r);if(s!==null&&C0(s),s=Cf(n,e,t,i),s===null&&Qh(n,e,i,$l,t),s===r)break;r=s}r!==null&&i.stopPropagation()}else Qh(n,e,i,null,t)}}var $l=null;function Cf(n,e,t,i){if($l=null,n=ld(i),n=Cr(n),n!==null)if(e=kr(n),e===null)n=null;else if(t=e.tag,t===13){if(n=_0(e),n!==null)return n;n=null}else if(t===3){if(e.stateNode.current.memoizedState.isDehydrated)return e.tag===3?e.stateNode.containerInfo:null;n=null}else e!==n&&(n=null);return $l=n,null}function D0(n){switch(n){case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 1;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"toggle":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 4;case"message":switch(eS()){case cd:return 1;case E0:return 4;case Xl:case tS:return 16;case T0:return 536870912;default:return 16}default:return 16}}var $i=null,dd=null,Dl=null;function N0(){if(Dl)return Dl;var n,e=dd,t=e.length,i,r="value"in $i?$i.value:$i.textContent,s=r.length;for(n=0;n<t&&e[n]===r[n];n++);var o=t-n;for(i=1;i<=o&&e[t-i]===r[s-i];i++);return Dl=r.slice(n,1<i?1-i:void 0)}function Nl(n){var e=n.keyCode;return"charCode"in n?(n=n.charCode,n===0&&e===13&&(n=13)):n=e,n===10&&(n=13),32<=n||n===13?n:0}function yl(){return!0}function cg(){return!1}function Sn(n){function e(t,i,r,s,o){this._reactName=t,this._targetInst=r,this.type=i,this.nativeEvent=s,this.target=o,this.currentTarget=null;for(var a in n)n.hasOwnProperty(a)&&(t=n[a],this[a]=t?t(s):s[a]);return this.isDefaultPrevented=(s.defaultPrevented!=null?s.defaultPrevented:s.returnValue===!1)?yl:cg,this.isPropagationStopped=cg,this}return _t(e.prototype,{preventDefault:function(){this.defaultPrevented=!0;var t=this.nativeEvent;t&&(t.preventDefault?t.preventDefault():typeof t.returnValue!="unknown"&&(t.returnValue=!1),this.isDefaultPrevented=yl)},stopPropagation:function(){var t=this.nativeEvent;t&&(t.stopPropagation?t.stopPropagation():typeof t.cancelBubble!="unknown"&&(t.cancelBubble=!0),this.isPropagationStopped=yl)},persist:function(){},isPersistent:yl}),e}var Fs={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(n){return n.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},pd=Sn(Fs),ca=_t({},Fs,{view:0,detail:0}),pS=Sn(ca),Yh,qh,bo,dc=_t({},ca,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:md,button:0,buttons:0,relatedTarget:function(n){return n.relatedTarget===void 0?n.fromElement===n.srcElement?n.toElement:n.fromElement:n.relatedTarget},movementX:function(n){return"movementX"in n?n.movementX:(n!==bo&&(bo&&n.type==="mousemove"?(Yh=n.screenX-bo.screenX,qh=n.screenY-bo.screenY):qh=Yh=0,bo=n),Yh)},movementY:function(n){return"movementY"in n?n.movementY:qh}}),ug=Sn(dc),mS=_t({},dc,{dataTransfer:0}),gS=Sn(mS),vS=_t({},ca,{relatedTarget:0}),$h=Sn(vS),xS=_t({},Fs,{animationName:0,elapsedTime:0,pseudoElement:0}),yS=Sn(xS),_S=_t({},Fs,{clipboardData:function(n){return"clipboardData"in n?n.clipboardData:window.clipboardData}}),SS=Sn(_S),MS=_t({},Fs,{data:0}),hg=Sn(MS),wS={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},ES={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},TS={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function AS(n){var e=this.nativeEvent;return e.getModifierState?e.getModifierState(n):(n=TS[n])?!!e[n]:!1}function md(){return AS}var bS=_t({},ca,{key:function(n){if(n.key){var e=wS[n.key]||n.key;if(e!=="Unidentified")return e}return n.type==="keypress"?(n=Nl(n),n===13?"Enter":String.fromCharCode(n)):n.type==="keydown"||n.type==="keyup"?ES[n.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:md,charCode:function(n){return n.type==="keypress"?Nl(n):0},keyCode:function(n){return n.type==="keydown"||n.type==="keyup"?n.keyCode:0},which:function(n){return n.type==="keypress"?Nl(n):n.type==="keydown"||n.type==="keyup"?n.keyCode:0}}),CS=Sn(bS),RS=_t({},dc,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),fg=Sn(RS),PS=_t({},ca,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:md}),IS=Sn(PS),LS=_t({},Fs,{propertyName:0,elapsedTime:0,pseudoElement:0}),DS=Sn(LS),NS=_t({},dc,{deltaX:function(n){return"deltaX"in n?n.deltaX:"wheelDeltaX"in n?-n.wheelDeltaX:0},deltaY:function(n){return"deltaY"in n?n.deltaY:"wheelDeltaY"in n?-n.wheelDeltaY:"wheelDelta"in n?-n.wheelDelta:0},deltaZ:0,deltaMode:0}),US=Sn(NS),FS=[9,13,27,32],gd=Mi&&"CompositionEvent"in window,Bo=null;Mi&&"documentMode"in document&&(Bo=document.documentMode);var OS=Mi&&"TextEvent"in window&&!Bo,U0=Mi&&(!gd||Bo&&8<Bo&&11>=Bo),dg=" ",pg=!1;function F0(n,e){switch(n){case"keyup":return FS.indexOf(e.keyCode)!==-1;case"keydown":return e.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function O0(n){return n=n.detail,typeof n=="object"&&"data"in n?n.data:null}var ds=!1;function BS(n,e){switch(n){case"compositionend":return O0(e);case"keypress":return e.which!==32?null:(pg=!0,dg);case"textInput":return n=e.data,n===dg&&pg?null:n;default:return null}}function kS(n,e){if(ds)return n==="compositionend"||!gd&&F0(n,e)?(n=N0(),Dl=dd=$i=null,ds=!1,n):null;switch(n){case"paste":return null;case"keypress":if(!(e.ctrlKey||e.altKey||e.metaKey)||e.ctrlKey&&e.altKey){if(e.char&&1<e.char.length)return e.char;if(e.which)return String.fromCharCode(e.which)}return null;case"compositionend":return U0&&e.locale!=="ko"?null:e.data;default:return null}}var zS={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function mg(n){var e=n&&n.nodeName&&n.nodeName.toLowerCase();return e==="input"?!!zS[n.type]:e==="textarea"}function B0(n,e,t,i){m0(i),e=Zl(e,"onChange"),0<e.length&&(t=new pd("onChange","change",null,t,i),n.push({event:t,listeners:e}))}var ko=null,Ko=null;function VS(n){Z0(n,0)}function pc(n){var e=gs(n);if(l0(e))return n}function HS(n,e){if(n==="change")return e}var k0=!1;Mi&&(Mi?(Sl="oninput"in document,Sl||(Zh=document.createElement("div"),Zh.setAttribute("oninput","return;"),Sl=typeof Zh.oninput=="function"),_l=Sl):_l=!1,k0=_l&&(!document.documentMode||9<document.documentMode));var _l,Sl,Zh;function gg(){ko&&(ko.detachEvent("onpropertychange",z0),Ko=ko=null)}function z0(n){if(n.propertyName==="value"&&pc(Ko)){var e=[];B0(e,Ko,n,ld(n)),y0(VS,e)}}function GS(n,e,t){n==="focusin"?(gg(),ko=e,Ko=t,ko.attachEvent("onpropertychange",z0)):n==="focusout"&&gg()}function WS(n){if(n==="selectionchange"||n==="keyup"||n==="keydown")return pc(Ko)}function XS(n,e){if(n==="click")return pc(e)}function YS(n,e){if(n==="input"||n==="change")return pc(e)}function qS(n,e){return n===e&&(n!==0||1/n===1/e)||n!==n&&e!==e}var $n=typeof Object.is=="function"?Object.is:qS;function Qo(n,e){if($n(n,e))return!0;if(typeof n!="object"||n===null||typeof e!="object"||e===null)return!1;var t=Object.keys(n),i=Object.keys(e);if(t.length!==i.length)return!1;for(i=0;i<t.length;i++){var r=t[i];if(!uf.call(e,r)||!$n(n[r],e[r]))return!1}return!0}function vg(n){for(;n&&n.firstChild;)n=n.firstChild;return n}function xg(n,e){var t=vg(n);n=0;for(var i;t;){if(t.nodeType===3){if(i=n+t.textContent.length,n<=e&&i>=e)return{node:t,offset:e-n};n=i}e:{for(;t;){if(t.nextSibling){t=t.nextSibling;break e}t=t.parentNode}t=void 0}t=vg(t)}}function V0(n,e){return n&&e?n===e?!0:n&&n.nodeType===3?!1:e&&e.nodeType===3?V0(n,e.parentNode):"contains"in n?n.contains(e):n.compareDocumentPosition?!!(n.compareDocumentPosition(e)&16):!1:!1}function H0(){for(var n=window,e=Hl();e instanceof n.HTMLIFrameElement;){try{var t=typeof e.contentWindow.location.href=="string"}catch{t=!1}if(t)n=e.contentWindow;else break;e=Hl(n.document)}return e}function vd(n){var e=n&&n.nodeName&&n.nodeName.toLowerCase();return e&&(e==="input"&&(n.type==="text"||n.type==="search"||n.type==="tel"||n.type==="url"||n.type==="password")||e==="textarea"||n.contentEditable==="true")}function $S(n){var e=H0(),t=n.focusedElem,i=n.selectionRange;if(e!==t&&t&&t.ownerDocument&&V0(t.ownerDocument.documentElement,t)){if(i!==null&&vd(t)){if(e=i.start,n=i.end,n===void 0&&(n=e),"selectionStart"in t)t.selectionStart=e,t.selectionEnd=Math.min(n,t.value.length);else if(n=(e=t.ownerDocument||document)&&e.defaultView||window,n.getSelection){n=n.getSelection();var r=t.textContent.length,s=Math.min(i.start,r);i=i.end===void 0?s:Math.min(i.end,r),!n.extend&&s>i&&(r=i,i=s,s=r),r=xg(t,s);var o=xg(t,i);r&&o&&(n.rangeCount!==1||n.anchorNode!==r.node||n.anchorOffset!==r.offset||n.focusNode!==o.node||n.focusOffset!==o.offset)&&(e=e.createRange(),e.setStart(r.node,r.offset),n.removeAllRanges(),s>i?(n.addRange(e),n.extend(o.node,o.offset)):(e.setEnd(o.node,o.offset),n.addRange(e)))}}for(e=[],n=t;n=n.parentNode;)n.nodeType===1&&e.push({element:n,left:n.scrollLeft,top:n.scrollTop});for(typeof t.focus=="function"&&t.focus(),t=0;t<e.length;t++)n=e[t],n.element.scrollLeft=n.left,n.element.scrollTop=n.top}}var ZS=Mi&&"documentMode"in document&&11>=document.documentMode,ps=null,Rf=null,zo=null,Pf=!1;function yg(n,e,t){var i=t.window===t?t.document:t.nodeType===9?t:t.ownerDocument;Pf||ps==null||ps!==Hl(i)||(i=ps,"selectionStart"in i&&vd(i)?i={start:i.selectionStart,end:i.selectionEnd}:(i=(i.ownerDocument&&i.ownerDocument.defaultView||window).getSelection(),i={anchorNode:i.anchorNode,anchorOffset:i.anchorOffset,focusNode:i.focusNode,focusOffset:i.focusOffset}),zo&&Qo(zo,i)||(zo=i,i=Zl(Rf,"onSelect"),0<i.length&&(e=new pd("onSelect","select",null,e,t),n.push({event:e,listeners:i}),e.target=ps)))}function Ml(n,e){var t={};return t[n.toLowerCase()]=e.toLowerCase(),t["Webkit"+n]="webkit"+e,t["Moz"+n]="moz"+e,t}var ms={animationend:Ml("Animation","AnimationEnd"),animationiteration:Ml("Animation","AnimationIteration"),animationstart:Ml("Animation","AnimationStart"),transitionend:Ml("Transition","TransitionEnd")},Jh={},G0={};Mi&&(G0=document.createElement("div").style,"AnimationEvent"in window||(delete ms.animationend.animation,delete ms.animationiteration.animation,delete ms.animationstart.animation),"TransitionEvent"in window||delete ms.transitionend.transition);function mc(n){if(Jh[n])return Jh[n];if(!ms[n])return n;var e=ms[n],t;for(t in e)if(e.hasOwnProperty(t)&&t in G0)return Jh[n]=e[t];return n}var W0=mc("animationend"),X0=mc("animationiteration"),Y0=mc("animationstart"),q0=mc("transitionend"),$0=new Map,_g="abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");function or(n,e){$0.set(n,e),Br(e,[n])}for(wl=0;wl<_g.length;wl++)El=_g[wl],Sg=El.toLowerCase(),Mg=El[0].toUpperCase()+El.slice(1),or(Sg,"on"+Mg);var El,Sg,Mg,wl;or(W0,"onAnimationEnd");or(X0,"onAnimationIteration");or(Y0,"onAnimationStart");or("dblclick","onDoubleClick");or("focusin","onFocus");or("focusout","onBlur");or(q0,"onTransitionEnd");Rs("onMouseEnter",["mouseout","mouseover"]);Rs("onMouseLeave",["mouseout","mouseover"]);Rs("onPointerEnter",["pointerout","pointerover"]);Rs("onPointerLeave",["pointerout","pointerover"]);Br("onChange","change click focusin focusout input keydown keyup selectionchange".split(" "));Br("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));Br("onBeforeInput",["compositionend","keypress","textInput","paste"]);Br("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" "));Br("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" "));Br("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var Uo="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),JS=new Set("cancel close invalid load scroll toggle".split(" ").concat(Uo));function wg(n,e,t){var i=n.type||"unknown-event";n.currentTarget=t,J_(i,e,void 0,n),n.currentTarget=null}function Z0(n,e){e=(e&4)!==0;for(var t=0;t<n.length;t++){var i=n[t],r=i.event;i=i.listeners;e:{var s=void 0;if(e)for(var o=i.length-1;0<=o;o--){var a=i[o],l=a.instance,u=a.currentTarget;if(a=a.listener,l!==s&&r.isPropagationStopped())break e;wg(r,a,u),s=l}else for(o=0;o<i.length;o++){if(a=i[o],l=a.instance,u=a.currentTarget,a=a.listener,l!==s&&r.isPropagationStopped())break e;wg(r,a,u),s=l}}}if(Wl)throw n=Tf,Wl=!1,Tf=null,n}function ft(n,e){var t=e[Uf];t===void 0&&(t=e[Uf]=new Set);var i=n+"__bubble";t.has(i)||(J0(e,n,2,!1),t.add(i))}function Kh(n,e,t){var i=0;e&&(i|=4),J0(t,n,i,e)}var Tl="_reactListening"+Math.random().toString(36).slice(2);function jo(n){if(!n[Tl]){n[Tl]=!0,i0.forEach(function(t){t!=="selectionchange"&&(JS.has(t)||Kh(t,!1,n),Kh(t,!0,n))});var e=n.nodeType===9?n:n.ownerDocument;e===null||e[Tl]||(e[Tl]=!0,Kh("selectionchange",!1,e))}}function J0(n,e,t,i){switch(D0(e)){case 1:var r=fS;break;case 4:r=dS;break;default:r=fd}t=r.bind(null,e,t,n),r=void 0,!Ef||e!=="touchstart"&&e!=="touchmove"&&e!=="wheel"||(r=!0),i?r!==void 0?n.addEventListener(e,t,{capture:!0,passive:r}):n.addEventListener(e,t,!0):r!==void 0?n.addEventListener(e,t,{passive:r}):n.addEventListener(e,t,!1)}function Qh(n,e,t,i,r){var s=i;if((e&1)===0&&(e&2)===0&&i!==null)e:for(;;){if(i===null)return;var o=i.tag;if(o===3||o===4){var a=i.stateNode.containerInfo;if(a===r||a.nodeType===8&&a.parentNode===r)break;if(o===4)for(o=i.return;o!==null;){var l=o.tag;if((l===3||l===4)&&(l=o.stateNode.containerInfo,l===r||l.nodeType===8&&l.parentNode===r))return;o=o.return}for(;a!==null;){if(o=Cr(a),o===null)return;if(l=o.tag,l===5||l===6){i=s=o;continue e}a=a.parentNode}}i=i.return}y0(function(){var u=s,h=ld(t),c=[];e:{var f=$0.get(n);if(f!==void 0){var d=pd,m=n;switch(n){case"keypress":if(Nl(t)===0)break e;case"keydown":case"keyup":d=CS;break;case"focusin":m="focus",d=$h;break;case"focusout":m="blur",d=$h;break;case"beforeblur":case"afterblur":d=$h;break;case"click":if(t.button===2)break e;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":d=ug;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":d=gS;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":d=IS;break;case W0:case X0:case Y0:d=yS;break;case q0:d=DS;break;case"scroll":d=pS;break;case"wheel":d=US;break;case"copy":case"cut":case"paste":d=SS;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":d=fg}var x=(e&4)!==0,y=!x&&n==="scroll",p=x?f!==null?f+"Capture":null:f;x=[];for(var _=u,g;_!==null;){g=_;var v=g.stateNode;if(g.tag===5&&v!==null&&(g=v,p!==null&&(v=qo(_,p),v!=null&&x.push(ea(_,v,g)))),y)break;_=_.return}0<x.length&&(f=new d(f,m,null,t,h),c.push({event:f,listeners:x}))}}if((e&7)===0){e:{if(f=n==="mouseover"||n==="pointerover",d=n==="mouseout"||n==="pointerout",f&&t!==Mf&&(m=t.relatedTarget||t.fromElement)&&(Cr(m)||m[wi]))break e;if((d||f)&&(f=h.window===h?h:(f=h.ownerDocument)?f.defaultView||f.parentWindow:window,d?(m=t.relatedTarget||t.toElement,d=u,m=m?Cr(m):null,m!==null&&(y=kr(m),m!==y||m.tag!==5&&m.tag!==6)&&(m=null)):(d=null,m=u),d!==m)){if(x=ug,v="onMouseLeave",p="onMouseEnter",_="mouse",(n==="pointerout"||n==="pointerover")&&(x=fg,v="onPointerLeave",p="onPointerEnter",_="pointer"),y=d==null?f:gs(d),g=m==null?f:gs(m),f=new x(v,_+"leave",d,t,h),f.target=y,f.relatedTarget=g,v=null,Cr(h)===u&&(x=new x(p,_+"enter",m,t,h),x.target=g,x.relatedTarget=y,v=x),y=v,d&&m)t:{for(x=d,p=m,_=0,g=x;g;g=us(g))_++;for(g=0,v=p;v;v=us(v))g++;for(;0<_-g;)x=us(x),_--;for(;0<g-_;)p=us(p),g--;for(;_--;){if(x===p||p!==null&&x===p.alternate)break t;x=us(x),p=us(p)}x=null}else x=null;d!==null&&Eg(c,f,d,x,!1),m!==null&&y!==null&&Eg(c,y,m,x,!0)}}e:{if(f=u?gs(u):window,d=f.nodeName&&f.nodeName.toLowerCase(),d==="select"||d==="input"&&f.type==="file")var M=HS;else if(mg(f))if(k0)M=YS;else{M=WS;var S=GS}else(d=f.nodeName)&&d.toLowerCase()==="input"&&(f.type==="checkbox"||f.type==="radio")&&(M=XS);if(M&&(M=M(n,u))){B0(c,M,t,h);break e}S&&S(n,f,u),n==="focusout"&&(S=f._wrapperState)&&S.controlled&&f.type==="number"&&vf(f,"number",f.value)}switch(S=u?gs(u):window,n){case"focusin":(mg(S)||S.contentEditable==="true")&&(ps=S,Rf=u,zo=null);break;case"focusout":zo=Rf=ps=null;break;case"mousedown":Pf=!0;break;case"contextmenu":case"mouseup":case"dragend":Pf=!1,yg(c,t,h);break;case"selectionchange":if(ZS)break;case"keydown":case"keyup":yg(c,t,h)}var E;if(gd)e:{switch(n){case"compositionstart":var A="onCompositionStart";break e;case"compositionend":A="onCompositionEnd";break e;case"compositionupdate":A="onCompositionUpdate";break e}A=void 0}else ds?F0(n,t)&&(A="onCompositionEnd"):n==="keydown"&&t.keyCode===229&&(A="onCompositionStart");A&&(U0&&t.locale!=="ko"&&(ds||A!=="onCompositionStart"?A==="onCompositionEnd"&&ds&&(E=N0()):($i=h,dd="value"in $i?$i.value:$i.textContent,ds=!0)),S=Zl(u,A),0<S.length&&(A=new hg(A,n,null,t,h),c.push({event:A,listeners:S}),E?A.data=E:(E=O0(t),E!==null&&(A.data=E)))),(E=OS?BS(n,t):kS(n,t))&&(u=Zl(u,"onBeforeInput"),0<u.length&&(h=new hg("onBeforeInput","beforeinput",null,t,h),c.push({event:h,listeners:u}),h.data=E))}Z0(c,e)})}function ea(n,e,t){return{instance:n,listener:e,currentTarget:t}}function Zl(n,e){for(var t=e+"Capture",i=[];n!==null;){var r=n,s=r.stateNode;r.tag===5&&s!==null&&(r=s,s=qo(n,t),s!=null&&i.unshift(ea(n,s,r)),s=qo(n,e),s!=null&&i.push(ea(n,s,r))),n=n.return}return i}function us(n){if(n===null)return null;do n=n.return;while(n&&n.tag!==5);return n||null}function Eg(n,e,t,i,r){for(var s=e._reactName,o=[];t!==null&&t!==i;){var a=t,l=a.alternate,u=a.stateNode;if(l!==null&&l===i)break;a.tag===5&&u!==null&&(a=u,r?(l=qo(t,s),l!=null&&o.unshift(ea(t,l,a))):r||(l=qo(t,s),l!=null&&o.push(ea(t,l,a)))),t=t.return}o.length!==0&&n.push({event:e,listeners:o})}var KS=/\r\n?/g,QS=/\u0000|\uFFFD/g;function Tg(n){return(typeof n=="string"?n:""+n).replace(KS,`
`).replace(QS,"")}function Al(n,e,t){if(e=Tg(e),Tg(n)!==e&&t)throw Error(ce(425))}function Jl(){}var If=null,Lf=null;function Df(n,e){return n==="textarea"||n==="noscript"||typeof e.children=="string"||typeof e.children=="number"||typeof e.dangerouslySetInnerHTML=="object"&&e.dangerouslySetInnerHTML!==null&&e.dangerouslySetInnerHTML.__html!=null}var Nf=typeof setTimeout=="function"?setTimeout:void 0,jS=typeof clearTimeout=="function"?clearTimeout:void 0,Ag=typeof Promise=="function"?Promise:void 0,eM=typeof queueMicrotask=="function"?queueMicrotask:typeof Ag<"u"?function(n){return Ag.resolve(null).then(n).catch(tM)}:Nf;function tM(n){setTimeout(function(){throw n})}function jh(n,e){var t=e,i=0;do{var r=t.nextSibling;if(n.removeChild(t),r&&r.nodeType===8)if(t=r.data,t==="/$"){if(i===0){n.removeChild(r),Jo(e);return}i--}else t!=="$"&&t!=="$?"&&t!=="$!"||i++;t=r}while(t);Jo(e)}function ji(n){for(;n!=null;n=n.nextSibling){var e=n.nodeType;if(e===1||e===3)break;if(e===8){if(e=n.data,e==="$"||e==="$!"||e==="$?")break;if(e==="/$")return null}}return n}function bg(n){n=n.previousSibling;for(var e=0;n;){if(n.nodeType===8){var t=n.data;if(t==="$"||t==="$!"||t==="$?"){if(e===0)return n;e--}else t==="/$"&&e++}n=n.previousSibling}return null}var Os=Math.random().toString(36).slice(2),li="__reactFiber$"+Os,ta="__reactProps$"+Os,wi="__reactContainer$"+Os,Uf="__reactEvents$"+Os,nM="__reactListeners$"+Os,iM="__reactHandles$"+Os;function Cr(n){var e=n[li];if(e)return e;for(var t=n.parentNode;t;){if(e=t[wi]||t[li]){if(t=e.alternate,e.child!==null||t!==null&&t.child!==null)for(n=bg(n);n!==null;){if(t=n[li])return t;n=bg(n)}return e}n=t,t=n.parentNode}return null}function ua(n){return n=n[li]||n[wi],!n||n.tag!==5&&n.tag!==6&&n.tag!==13&&n.tag!==3?null:n}function gs(n){if(n.tag===5||n.tag===6)return n.stateNode;throw Error(ce(33))}function gc(n){return n[ta]||null}var Ff=[],vs=-1;function ar(n){return{current:n}}function dt(n){0>vs||(n.current=Ff[vs],Ff[vs]=null,vs--)}function ut(n,e){vs++,Ff[vs]=n.current,n.current=e}var sr={},Wt=ar(sr),cn=ar(!1),Dr=sr;function Ps(n,e){var t=n.type.contextTypes;if(!t)return sr;var i=n.stateNode;if(i&&i.__reactInternalMemoizedUnmaskedChildContext===e)return i.__reactInternalMemoizedMaskedChildContext;var r={},s;for(s in t)r[s]=e[s];return i&&(n=n.stateNode,n.__reactInternalMemoizedUnmaskedChildContext=e,n.__reactInternalMemoizedMaskedChildContext=r),r}function un(n){return n=n.childContextTypes,n!=null}function Kl(){dt(cn),dt(Wt)}function Cg(n,e,t){if(Wt.current!==sr)throw Error(ce(168));ut(Wt,e),ut(cn,t)}function K0(n,e,t){var i=n.stateNode;if(e=e.childContextTypes,typeof i.getChildContext!="function")return t;i=i.getChildContext();for(var r in i)if(!(r in e))throw Error(ce(108,G_(n)||"Unknown",r));return _t({},t,i)}function Ql(n){return n=(n=n.stateNode)&&n.__reactInternalMemoizedMergedChildContext||sr,Dr=Wt.current,ut(Wt,n),ut(cn,cn.current),!0}function Rg(n,e,t){var i=n.stateNode;if(!i)throw Error(ce(169));t?(n=K0(n,e,Dr),i.__reactInternalMemoizedMergedChildContext=n,dt(cn),dt(Wt),ut(Wt,n)):dt(cn),ut(cn,t)}var xi=null,vc=!1,ef=!1;function Q0(n){xi===null?xi=[n]:xi.push(n)}function rM(n){vc=!0,Q0(n)}function lr(){if(!ef&&xi!==null){ef=!0;var n=0,e=rt;try{var t=xi;for(rt=1;n<t.length;n++){var i=t[n];do i=i(!0);while(i!==null)}xi=null,vc=!1}catch(r){throw xi!==null&&(xi=xi.slice(n+1)),w0(cd,lr),r}finally{rt=e,ef=!1}}return null}var xs=[],ys=0,jl=null,ec=0,In=[],Ln=0,Nr=null,yi=1,_i="";function Ar(n,e){xs[ys++]=ec,xs[ys++]=jl,jl=n,ec=e}function j0(n,e,t){In[Ln++]=yi,In[Ln++]=_i,In[Ln++]=Nr,Nr=n;var i=yi;n=_i;var r=32-Yn(i)-1;i&=~(1<<r),t+=1;var s=32-Yn(e)+r;if(30<s){var o=r-r%5;s=(i&(1<<o)-1).toString(32),i>>=o,r-=o,yi=1<<32-Yn(e)+r|t<<r|i,_i=s+n}else yi=1<<s|t<<r|i,_i=n}function xd(n){n.return!==null&&(Ar(n,1),j0(n,1,0))}function yd(n){for(;n===jl;)jl=xs[--ys],xs[ys]=null,ec=xs[--ys],xs[ys]=null;for(;n===Nr;)Nr=In[--Ln],In[Ln]=null,_i=In[--Ln],In[Ln]=null,yi=In[--Ln],In[Ln]=null}var yn=null,xn=null,mt=!1,Xn=null;function ev(n,e){var t=Dn(5,null,null,0);t.elementType="DELETED",t.stateNode=e,t.return=n,e=n.deletions,e===null?(n.deletions=[t],n.flags|=16):e.push(t)}function Pg(n,e){switch(n.tag){case 5:var t=n.type;return e=e.nodeType!==1||t.toLowerCase()!==e.nodeName.toLowerCase()?null:e,e!==null?(n.stateNode=e,yn=n,xn=ji(e.firstChild),!0):!1;case 6:return e=n.pendingProps===""||e.nodeType!==3?null:e,e!==null?(n.stateNode=e,yn=n,xn=null,!0):!1;case 13:return e=e.nodeType!==8?null:e,e!==null?(t=Nr!==null?{id:yi,overflow:_i}:null,n.memoizedState={dehydrated:e,treeContext:t,retryLane:1073741824},t=Dn(18,null,null,0),t.stateNode=e,t.return=n,n.child=t,yn=n,xn=null,!0):!1;default:return!1}}function Of(n){return(n.mode&1)!==0&&(n.flags&128)===0}function Bf(n){if(mt){var e=xn;if(e){var t=e;if(!Pg(n,e)){if(Of(n))throw Error(ce(418));e=ji(t.nextSibling);var i=yn;e&&Pg(n,e)?ev(i,t):(n.flags=n.flags&-4097|2,mt=!1,yn=n)}}else{if(Of(n))throw Error(ce(418));n.flags=n.flags&-4097|2,mt=!1,yn=n}}}function Ig(n){for(n=n.return;n!==null&&n.tag!==5&&n.tag!==3&&n.tag!==13;)n=n.return;yn=n}function bl(n){if(n!==yn)return!1;if(!mt)return Ig(n),mt=!0,!1;var e;if((e=n.tag!==3)&&!(e=n.tag!==5)&&(e=n.type,e=e!=="head"&&e!=="body"&&!Df(n.type,n.memoizedProps)),e&&(e=xn)){if(Of(n))throw tv(),Error(ce(418));for(;e;)ev(n,e),e=ji(e.nextSibling)}if(Ig(n),n.tag===13){if(n=n.memoizedState,n=n!==null?n.dehydrated:null,!n)throw Error(ce(317));e:{for(n=n.nextSibling,e=0;n;){if(n.nodeType===8){var t=n.data;if(t==="/$"){if(e===0){xn=ji(n.nextSibling);break e}e--}else t!=="$"&&t!=="$!"&&t!=="$?"||e++}n=n.nextSibling}xn=null}}else xn=yn?ji(n.stateNode.nextSibling):null;return!0}function tv(){for(var n=xn;n;)n=ji(n.nextSibling)}function Is(){xn=yn=null,mt=!1}function _d(n){Xn===null?Xn=[n]:Xn.push(n)}var sM=Ai.ReactCurrentBatchConfig;function Co(n,e,t){if(n=t.ref,n!==null&&typeof n!="function"&&typeof n!="object"){if(t._owner){if(t=t._owner,t){if(t.tag!==1)throw Error(ce(309));var i=t.stateNode}if(!i)throw Error(ce(147,n));var r=i,s=""+n;return e!==null&&e.ref!==null&&typeof e.ref=="function"&&e.ref._stringRef===s?e.ref:(e=function(o){var a=r.refs;o===null?delete a[s]:a[s]=o},e._stringRef=s,e)}if(typeof n!="string")throw Error(ce(284));if(!t._owner)throw Error(ce(290,n))}return n}function Cl(n,e){throw n=Object.prototype.toString.call(e),Error(ce(31,n==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":n))}function Lg(n){var e=n._init;return e(n._payload)}function nv(n){function e(p,_){if(n){var g=p.deletions;g===null?(p.deletions=[_],p.flags|=16):g.push(_)}}function t(p,_){if(!n)return null;for(;_!==null;)e(p,_),_=_.sibling;return null}function i(p,_){for(p=new Map;_!==null;)_.key!==null?p.set(_.key,_):p.set(_.index,_),_=_.sibling;return p}function r(p,_){return p=ir(p,_),p.index=0,p.sibling=null,p}function s(p,_,g){return p.index=g,n?(g=p.alternate,g!==null?(g=g.index,g<_?(p.flags|=2,_):g):(p.flags|=2,_)):(p.flags|=1048576,_)}function o(p){return n&&p.alternate===null&&(p.flags|=2),p}function a(p,_,g,v){return _===null||_.tag!==6?(_=lf(g,p.mode,v),_.return=p,_):(_=r(_,g),_.return=p,_)}function l(p,_,g,v){var M=g.type;return M===fs?h(p,_,g.props.children,v,g.key):_!==null&&(_.elementType===M||typeof M=="object"&&M!==null&&M.$$typeof===Wi&&Lg(M)===_.type)?(v=r(_,g.props),v.ref=Co(p,_,g),v.return=p,v):(v=Vl(g.type,g.key,g.props,null,p.mode,v),v.ref=Co(p,_,g),v.return=p,v)}function u(p,_,g,v){return _===null||_.tag!==4||_.stateNode.containerInfo!==g.containerInfo||_.stateNode.implementation!==g.implementation?(_=cf(g,p.mode,v),_.return=p,_):(_=r(_,g.children||[]),_.return=p,_)}function h(p,_,g,v,M){return _===null||_.tag!==7?(_=Lr(g,p.mode,v,M),_.return=p,_):(_=r(_,g),_.return=p,_)}function c(p,_,g){if(typeof _=="string"&&_!==""||typeof _=="number")return _=lf(""+_,p.mode,g),_.return=p,_;if(typeof _=="object"&&_!==null){switch(_.$$typeof){case dl:return g=Vl(_.type,_.key,_.props,null,p.mode,g),g.ref=Co(p,null,_),g.return=p,g;case hs:return _=cf(_,p.mode,g),_.return=p,_;case Wi:var v=_._init;return c(p,v(_._payload),g)}if(Do(_)||Eo(_))return _=Lr(_,p.mode,g,null),_.return=p,_;Cl(p,_)}return null}function f(p,_,g,v){var M=_!==null?_.key:null;if(typeof g=="string"&&g!==""||typeof g=="number")return M!==null?null:a(p,_,""+g,v);if(typeof g=="object"&&g!==null){switch(g.$$typeof){case dl:return g.key===M?l(p,_,g,v):null;case hs:return g.key===M?u(p,_,g,v):null;case Wi:return M=g._init,f(p,_,M(g._payload),v)}if(Do(g)||Eo(g))return M!==null?null:h(p,_,g,v,null);Cl(p,g)}return null}function d(p,_,g,v,M){if(typeof v=="string"&&v!==""||typeof v=="number")return p=p.get(g)||null,a(_,p,""+v,M);if(typeof v=="object"&&v!==null){switch(v.$$typeof){case dl:return p=p.get(v.key===null?g:v.key)||null,l(_,p,v,M);case hs:return p=p.get(v.key===null?g:v.key)||null,u(_,p,v,M);case Wi:var S=v._init;return d(p,_,g,S(v._payload),M)}if(Do(v)||Eo(v))return p=p.get(g)||null,h(_,p,v,M,null);Cl(_,v)}return null}function m(p,_,g,v){for(var M=null,S=null,E=_,A=_=0,w=null;E!==null&&A<g.length;A++){E.index>A?(w=E,E=null):w=E.sibling;var T=f(p,E,g[A],v);if(T===null){E===null&&(E=w);break}n&&E&&T.alternate===null&&e(p,E),_=s(T,_,A),S===null?M=T:S.sibling=T,S=T,E=w}if(A===g.length)return t(p,E),mt&&Ar(p,A),M;if(E===null){for(;A<g.length;A++)E=c(p,g[A],v),E!==null&&(_=s(E,_,A),S===null?M=E:S.sibling=E,S=E);return mt&&Ar(p,A),M}for(E=i(p,E);A<g.length;A++)w=d(E,p,A,g[A],v),w!==null&&(n&&w.alternate!==null&&E.delete(w.key===null?A:w.key),_=s(w,_,A),S===null?M=w:S.sibling=w,S=w);return n&&E.forEach(function(b){return e(p,b)}),mt&&Ar(p,A),M}function x(p,_,g,v){var M=Eo(g);if(typeof M!="function")throw Error(ce(150));if(g=M.call(g),g==null)throw Error(ce(151));for(var S=M=null,E=_,A=_=0,w=null,T=g.next();E!==null&&!T.done;A++,T=g.next()){E.index>A?(w=E,E=null):w=E.sibling;var b=f(p,E,T.value,v);if(b===null){E===null&&(E=w);break}n&&E&&b.alternate===null&&e(p,E),_=s(b,_,A),S===null?M=b:S.sibling=b,S=b,E=w}if(T.done)return t(p,E),mt&&Ar(p,A),M;if(E===null){for(;!T.done;A++,T=g.next())T=c(p,T.value,v),T!==null&&(_=s(T,_,A),S===null?M=T:S.sibling=T,S=T);return mt&&Ar(p,A),M}for(E=i(p,E);!T.done;A++,T=g.next())T=d(E,p,A,T.value,v),T!==null&&(n&&T.alternate!==null&&E.delete(T.key===null?A:T.key),_=s(T,_,A),S===null?M=T:S.sibling=T,S=T);return n&&E.forEach(function(L){return e(p,L)}),mt&&Ar(p,A),M}function y(p,_,g,v){if(typeof g=="object"&&g!==null&&g.type===fs&&g.key===null&&(g=g.props.children),typeof g=="object"&&g!==null){switch(g.$$typeof){case dl:e:{for(var M=g.key,S=_;S!==null;){if(S.key===M){if(M=g.type,M===fs){if(S.tag===7){t(p,S.sibling),_=r(S,g.props.children),_.return=p,p=_;break e}}else if(S.elementType===M||typeof M=="object"&&M!==null&&M.$$typeof===Wi&&Lg(M)===S.type){t(p,S.sibling),_=r(S,g.props),_.ref=Co(p,S,g),_.return=p,p=_;break e}t(p,S);break}else e(p,S);S=S.sibling}g.type===fs?(_=Lr(g.props.children,p.mode,v,g.key),_.return=p,p=_):(v=Vl(g.type,g.key,g.props,null,p.mode,v),v.ref=Co(p,_,g),v.return=p,p=v)}return o(p);case hs:e:{for(S=g.key;_!==null;){if(_.key===S)if(_.tag===4&&_.stateNode.containerInfo===g.containerInfo&&_.stateNode.implementation===g.implementation){t(p,_.sibling),_=r(_,g.children||[]),_.return=p,p=_;break e}else{t(p,_);break}else e(p,_);_=_.sibling}_=cf(g,p.mode,v),_.return=p,p=_}return o(p);case Wi:return S=g._init,y(p,_,S(g._payload),v)}if(Do(g))return m(p,_,g,v);if(Eo(g))return x(p,_,g,v);Cl(p,g)}return typeof g=="string"&&g!==""||typeof g=="number"?(g=""+g,_!==null&&_.tag===6?(t(p,_.sibling),_=r(_,g),_.return=p,p=_):(t(p,_),_=lf(g,p.mode,v),_.return=p,p=_),o(p)):t(p,_)}return y}var Ls=nv(!0),iv=nv(!1),tc=ar(null),nc=null,_s=null,Sd=null;function Md(){Sd=_s=nc=null}function wd(n){var e=tc.current;dt(tc),n._currentValue=e}function kf(n,e,t){for(;n!==null;){var i=n.alternate;if((n.childLanes&e)!==e?(n.childLanes|=e,i!==null&&(i.childLanes|=e)):i!==null&&(i.childLanes&e)!==e&&(i.childLanes|=e),n===t)break;n=n.return}}function bs(n,e){nc=n,Sd=_s=null,n=n.dependencies,n!==null&&n.firstContext!==null&&((n.lanes&e)!==0&&(ln=!0),n.firstContext=null)}function Un(n){var e=n._currentValue;if(Sd!==n)if(n={context:n,memoizedValue:e,next:null},_s===null){if(nc===null)throw Error(ce(308));_s=n,nc.dependencies={lanes:0,firstContext:n}}else _s=_s.next=n;return e}var Rr=null;function Ed(n){Rr===null?Rr=[n]:Rr.push(n)}function rv(n,e,t,i){var r=e.interleaved;return r===null?(t.next=t,Ed(e)):(t.next=r.next,r.next=t),e.interleaved=t,Ei(n,i)}function Ei(n,e){n.lanes|=e;var t=n.alternate;for(t!==null&&(t.lanes|=e),t=n,n=n.return;n!==null;)n.childLanes|=e,t=n.alternate,t!==null&&(t.childLanes|=e),t=n,n=n.return;return t.tag===3?t.stateNode:null}var Xi=!1;function Td(n){n.updateQueue={baseState:n.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,interleaved:null,lanes:0},effects:null}}function sv(n,e){n=n.updateQueue,e.updateQueue===n&&(e.updateQueue={baseState:n.baseState,firstBaseUpdate:n.firstBaseUpdate,lastBaseUpdate:n.lastBaseUpdate,shared:n.shared,effects:n.effects})}function Si(n,e){return{eventTime:n,lane:e,tag:0,payload:null,callback:null,next:null}}function er(n,e,t){var i=n.updateQueue;if(i===null)return null;if(i=i.shared,(et&2)!==0){var r=i.pending;return r===null?e.next=e:(e.next=r.next,r.next=e),i.pending=e,Ei(n,t)}return r=i.interleaved,r===null?(e.next=e,Ed(i)):(e.next=r.next,r.next=e),i.interleaved=e,Ei(n,t)}function Ul(n,e,t){if(e=e.updateQueue,e!==null&&(e=e.shared,(t&4194240)!==0)){var i=e.lanes;i&=n.pendingLanes,t|=i,e.lanes=t,ud(n,t)}}function Dg(n,e){var t=n.updateQueue,i=n.alternate;if(i!==null&&(i=i.updateQueue,t===i)){var r=null,s=null;if(t=t.firstBaseUpdate,t!==null){do{var o={eventTime:t.eventTime,lane:t.lane,tag:t.tag,payload:t.payload,callback:t.callback,next:null};s===null?r=s=o:s=s.next=o,t=t.next}while(t!==null);s===null?r=s=e:s=s.next=e}else r=s=e;t={baseState:i.baseState,firstBaseUpdate:r,lastBaseUpdate:s,shared:i.shared,effects:i.effects},n.updateQueue=t;return}n=t.lastBaseUpdate,n===null?t.firstBaseUpdate=e:n.next=e,t.lastBaseUpdate=e}function ic(n,e,t,i){var r=n.updateQueue;Xi=!1;var s=r.firstBaseUpdate,o=r.lastBaseUpdate,a=r.shared.pending;if(a!==null){r.shared.pending=null;var l=a,u=l.next;l.next=null,o===null?s=u:o.next=u,o=l;var h=n.alternate;h!==null&&(h=h.updateQueue,a=h.lastBaseUpdate,a!==o&&(a===null?h.firstBaseUpdate=u:a.next=u,h.lastBaseUpdate=l))}if(s!==null){var c=r.baseState;o=0,h=u=l=null,a=s;do{var f=a.lane,d=a.eventTime;if((i&f)===f){h!==null&&(h=h.next={eventTime:d,lane:0,tag:a.tag,payload:a.payload,callback:a.callback,next:null});e:{var m=n,x=a;switch(f=e,d=t,x.tag){case 1:if(m=x.payload,typeof m=="function"){c=m.call(d,c,f);break e}c=m;break e;case 3:m.flags=m.flags&-65537|128;case 0:if(m=x.payload,f=typeof m=="function"?m.call(d,c,f):m,f==null)break e;c=_t({},c,f);break e;case 2:Xi=!0}}a.callback!==null&&a.lane!==0&&(n.flags|=64,f=r.effects,f===null?r.effects=[a]:f.push(a))}else d={eventTime:d,lane:f,tag:a.tag,payload:a.payload,callback:a.callback,next:null},h===null?(u=h=d,l=c):h=h.next=d,o|=f;if(a=a.next,a===null){if(a=r.shared.pending,a===null)break;f=a,a=f.next,f.next=null,r.lastBaseUpdate=f,r.shared.pending=null}}while(!0);if(h===null&&(l=c),r.baseState=l,r.firstBaseUpdate=u,r.lastBaseUpdate=h,e=r.shared.interleaved,e!==null){r=e;do o|=r.lane,r=r.next;while(r!==e)}else s===null&&(r.shared.lanes=0);Fr|=o,n.lanes=o,n.memoizedState=c}}function Ng(n,e,t){if(n=e.effects,e.effects=null,n!==null)for(e=0;e<n.length;e++){var i=n[e],r=i.callback;if(r!==null){if(i.callback=null,i=t,typeof r!="function")throw Error(ce(191,r));r.call(i)}}}var ha={},ui=ar(ha),na=ar(ha),ia=ar(ha);function Pr(n){if(n===ha)throw Error(ce(174));return n}function Ad(n,e){switch(ut(ia,e),ut(na,n),ut(ui,ha),n=e.nodeType,n){case 9:case 11:e=(e=e.documentElement)?e.namespaceURI:yf(null,"");break;default:n=n===8?e.parentNode:e,e=n.namespaceURI||null,n=n.tagName,e=yf(e,n)}dt(ui),ut(ui,e)}function Ds(){dt(ui),dt(na),dt(ia)}function ov(n){Pr(ia.current);var e=Pr(ui.current),t=yf(e,n.type);e!==t&&(ut(na,n),ut(ui,t))}function bd(n){na.current===n&&(dt(ui),dt(na))}var xt=ar(0);function rc(n){for(var e=n;e!==null;){if(e.tag===13){var t=e.memoizedState;if(t!==null&&(t=t.dehydrated,t===null||t.data==="$?"||t.data==="$!"))return e}else if(e.tag===19&&e.memoizedProps.revealOrder!==void 0){if((e.flags&128)!==0)return e}else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===n)break;for(;e.sibling===null;){if(e.return===null||e.return===n)return null;e=e.return}e.sibling.return=e.return,e=e.sibling}return null}var tf=[];function Cd(){for(var n=0;n<tf.length;n++)tf[n]._workInProgressVersionPrimary=null;tf.length=0}var Fl=Ai.ReactCurrentDispatcher,nf=Ai.ReactCurrentBatchConfig,Ur=0,yt=null,Rt=null,Dt=null,sc=!1,Vo=!1,ra=0,oM=0;function Vt(){throw Error(ce(321))}function Rd(n,e){if(e===null)return!1;for(var t=0;t<e.length&&t<n.length;t++)if(!$n(n[t],e[t]))return!1;return!0}function Pd(n,e,t,i,r,s){if(Ur=s,yt=e,e.memoizedState=null,e.updateQueue=null,e.lanes=0,Fl.current=n===null||n.memoizedState===null?uM:hM,n=t(i,r),Vo){s=0;do{if(Vo=!1,ra=0,25<=s)throw Error(ce(301));s+=1,Dt=Rt=null,e.updateQueue=null,Fl.current=fM,n=t(i,r)}while(Vo)}if(Fl.current=oc,e=Rt!==null&&Rt.next!==null,Ur=0,Dt=Rt=yt=null,sc=!1,e)throw Error(ce(300));return n}function Id(){var n=ra!==0;return ra=0,n}function ai(){var n={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return Dt===null?yt.memoizedState=Dt=n:Dt=Dt.next=n,Dt}function Fn(){if(Rt===null){var n=yt.alternate;n=n!==null?n.memoizedState:null}else n=Rt.next;var e=Dt===null?yt.memoizedState:Dt.next;if(e!==null)Dt=e,Rt=n;else{if(n===null)throw Error(ce(310));Rt=n,n={memoizedState:Rt.memoizedState,baseState:Rt.baseState,baseQueue:Rt.baseQueue,queue:Rt.queue,next:null},Dt===null?yt.memoizedState=Dt=n:Dt=Dt.next=n}return Dt}function sa(n,e){return typeof e=="function"?e(n):e}function rf(n){var e=Fn(),t=e.queue;if(t===null)throw Error(ce(311));t.lastRenderedReducer=n;var i=Rt,r=i.baseQueue,s=t.pending;if(s!==null){if(r!==null){var o=r.next;r.next=s.next,s.next=o}i.baseQueue=r=s,t.pending=null}if(r!==null){s=r.next,i=i.baseState;var a=o=null,l=null,u=s;do{var h=u.lane;if((Ur&h)===h)l!==null&&(l=l.next={lane:0,action:u.action,hasEagerState:u.hasEagerState,eagerState:u.eagerState,next:null}),i=u.hasEagerState?u.eagerState:n(i,u.action);else{var c={lane:h,action:u.action,hasEagerState:u.hasEagerState,eagerState:u.eagerState,next:null};l===null?(a=l=c,o=i):l=l.next=c,yt.lanes|=h,Fr|=h}u=u.next}while(u!==null&&u!==s);l===null?o=i:l.next=a,$n(i,e.memoizedState)||(ln=!0),e.memoizedState=i,e.baseState=o,e.baseQueue=l,t.lastRenderedState=i}if(n=t.interleaved,n!==null){r=n;do s=r.lane,yt.lanes|=s,Fr|=s,r=r.next;while(r!==n)}else r===null&&(t.lanes=0);return[e.memoizedState,t.dispatch]}function sf(n){var e=Fn(),t=e.queue;if(t===null)throw Error(ce(311));t.lastRenderedReducer=n;var i=t.dispatch,r=t.pending,s=e.memoizedState;if(r!==null){t.pending=null;var o=r=r.next;do s=n(s,o.action),o=o.next;while(o!==r);$n(s,e.memoizedState)||(ln=!0),e.memoizedState=s,e.baseQueue===null&&(e.baseState=s),t.lastRenderedState=s}return[s,i]}function av(){}function lv(n,e){var t=yt,i=Fn(),r=e(),s=!$n(i.memoizedState,r);if(s&&(i.memoizedState=r,ln=!0),i=i.queue,Ld(hv.bind(null,t,i,n),[n]),i.getSnapshot!==e||s||Dt!==null&&Dt.memoizedState.tag&1){if(t.flags|=2048,oa(9,uv.bind(null,t,i,r,e),void 0,null),Nt===null)throw Error(ce(349));(Ur&30)!==0||cv(t,e,r)}return r}function cv(n,e,t){n.flags|=16384,n={getSnapshot:e,value:t},e=yt.updateQueue,e===null?(e={lastEffect:null,stores:null},yt.updateQueue=e,e.stores=[n]):(t=e.stores,t===null?e.stores=[n]:t.push(n))}function uv(n,e,t,i){e.value=t,e.getSnapshot=i,fv(e)&&dv(n)}function hv(n,e,t){return t(function(){fv(e)&&dv(n)})}function fv(n){var e=n.getSnapshot;n=n.value;try{var t=e();return!$n(n,t)}catch{return!0}}function dv(n){var e=Ei(n,1);e!==null&&qn(e,n,1,-1)}function Ug(n){var e=ai();return typeof n=="function"&&(n=n()),e.memoizedState=e.baseState=n,n={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:sa,lastRenderedState:n},e.queue=n,n=n.dispatch=cM.bind(null,yt,n),[e.memoizedState,n]}function oa(n,e,t,i){return n={tag:n,create:e,destroy:t,deps:i,next:null},e=yt.updateQueue,e===null?(e={lastEffect:null,stores:null},yt.updateQueue=e,e.lastEffect=n.next=n):(t=e.lastEffect,t===null?e.lastEffect=n.next=n:(i=t.next,t.next=n,n.next=i,e.lastEffect=n)),n}function pv(){return Fn().memoizedState}function Ol(n,e,t,i){var r=ai();yt.flags|=n,r.memoizedState=oa(1|e,t,void 0,i===void 0?null:i)}function xc(n,e,t,i){var r=Fn();i=i===void 0?null:i;var s=void 0;if(Rt!==null){var o=Rt.memoizedState;if(s=o.destroy,i!==null&&Rd(i,o.deps)){r.memoizedState=oa(e,t,s,i);return}}yt.flags|=n,r.memoizedState=oa(1|e,t,s,i)}function Fg(n,e){return Ol(8390656,8,n,e)}function Ld(n,e){return xc(2048,8,n,e)}function mv(n,e){return xc(4,2,n,e)}function gv(n,e){return xc(4,4,n,e)}function vv(n,e){if(typeof e=="function")return n=n(),e(n),function(){e(null)};if(e!=null)return n=n(),e.current=n,function(){e.current=null}}function xv(n,e,t){return t=t!=null?t.concat([n]):null,xc(4,4,vv.bind(null,e,n),t)}function Dd(){}function yv(n,e){var t=Fn();e=e===void 0?null:e;var i=t.memoizedState;return i!==null&&e!==null&&Rd(e,i[1])?i[0]:(t.memoizedState=[n,e],n)}function _v(n,e){var t=Fn();e=e===void 0?null:e;var i=t.memoizedState;return i!==null&&e!==null&&Rd(e,i[1])?i[0]:(n=n(),t.memoizedState=[n,e],n)}function Sv(n,e,t){return(Ur&21)===0?(n.baseState&&(n.baseState=!1,ln=!0),n.memoizedState=t):($n(t,e)||(t=A0(),yt.lanes|=t,Fr|=t,n.baseState=!0),e)}function aM(n,e){var t=rt;rt=t!==0&&4>t?t:4,n(!0);var i=nf.transition;nf.transition={};try{n(!1),e()}finally{rt=t,nf.transition=i}}function Mv(){return Fn().memoizedState}function lM(n,e,t){var i=nr(n);if(t={lane:i,action:t,hasEagerState:!1,eagerState:null,next:null},wv(n))Ev(e,t);else if(t=rv(n,e,t,i),t!==null){var r=tn();qn(t,n,i,r),Tv(t,e,i)}}function cM(n,e,t){var i=nr(n),r={lane:i,action:t,hasEagerState:!1,eagerState:null,next:null};if(wv(n))Ev(e,r);else{var s=n.alternate;if(n.lanes===0&&(s===null||s.lanes===0)&&(s=e.lastRenderedReducer,s!==null))try{var o=e.lastRenderedState,a=s(o,t);if(r.hasEagerState=!0,r.eagerState=a,$n(a,o)){var l=e.interleaved;l===null?(r.next=r,Ed(e)):(r.next=l.next,l.next=r),e.interleaved=r;return}}catch{}finally{}t=rv(n,e,r,i),t!==null&&(r=tn(),qn(t,n,i,r),Tv(t,e,i))}}function wv(n){var e=n.alternate;return n===yt||e!==null&&e===yt}function Ev(n,e){Vo=sc=!0;var t=n.pending;t===null?e.next=e:(e.next=t.next,t.next=e),n.pending=e}function Tv(n,e,t){if((t&4194240)!==0){var i=e.lanes;i&=n.pendingLanes,t|=i,e.lanes=t,ud(n,t)}}var oc={readContext:Un,useCallback:Vt,useContext:Vt,useEffect:Vt,useImperativeHandle:Vt,useInsertionEffect:Vt,useLayoutEffect:Vt,useMemo:Vt,useReducer:Vt,useRef:Vt,useState:Vt,useDebugValue:Vt,useDeferredValue:Vt,useTransition:Vt,useMutableSource:Vt,useSyncExternalStore:Vt,useId:Vt,unstable_isNewReconciler:!1},uM={readContext:Un,useCallback:function(n,e){return ai().memoizedState=[n,e===void 0?null:e],n},useContext:Un,useEffect:Fg,useImperativeHandle:function(n,e,t){return t=t!=null?t.concat([n]):null,Ol(4194308,4,vv.bind(null,e,n),t)},useLayoutEffect:function(n,e){return Ol(4194308,4,n,e)},useInsertionEffect:function(n,e){return Ol(4,2,n,e)},useMemo:function(n,e){var t=ai();return e=e===void 0?null:e,n=n(),t.memoizedState=[n,e],n},useReducer:function(n,e,t){var i=ai();return e=t!==void 0?t(e):e,i.memoizedState=i.baseState=e,n={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:n,lastRenderedState:e},i.queue=n,n=n.dispatch=lM.bind(null,yt,n),[i.memoizedState,n]},useRef:function(n){var e=ai();return n={current:n},e.memoizedState=n},useState:Ug,useDebugValue:Dd,useDeferredValue:function(n){return ai().memoizedState=n},useTransition:function(){var n=Ug(!1),e=n[0];return n=aM.bind(null,n[1]),ai().memoizedState=n,[e,n]},useMutableSource:function(){},useSyncExternalStore:function(n,e,t){var i=yt,r=ai();if(mt){if(t===void 0)throw Error(ce(407));t=t()}else{if(t=e(),Nt===null)throw Error(ce(349));(Ur&30)!==0||cv(i,e,t)}r.memoizedState=t;var s={value:t,getSnapshot:e};return r.queue=s,Fg(hv.bind(null,i,s,n),[n]),i.flags|=2048,oa(9,uv.bind(null,i,s,t,e),void 0,null),t},useId:function(){var n=ai(),e=Nt.identifierPrefix;if(mt){var t=_i,i=yi;t=(i&~(1<<32-Yn(i)-1)).toString(32)+t,e=":"+e+"R"+t,t=ra++,0<t&&(e+="H"+t.toString(32)),e+=":"}else t=oM++,e=":"+e+"r"+t.toString(32)+":";return n.memoizedState=e},unstable_isNewReconciler:!1},hM={readContext:Un,useCallback:yv,useContext:Un,useEffect:Ld,useImperativeHandle:xv,useInsertionEffect:mv,useLayoutEffect:gv,useMemo:_v,useReducer:rf,useRef:pv,useState:function(){return rf(sa)},useDebugValue:Dd,useDeferredValue:function(n){var e=Fn();return Sv(e,Rt.memoizedState,n)},useTransition:function(){var n=rf(sa)[0],e=Fn().memoizedState;return[n,e]},useMutableSource:av,useSyncExternalStore:lv,useId:Mv,unstable_isNewReconciler:!1},fM={readContext:Un,useCallback:yv,useContext:Un,useEffect:Ld,useImperativeHandle:xv,useInsertionEffect:mv,useLayoutEffect:gv,useMemo:_v,useReducer:sf,useRef:pv,useState:function(){return sf(sa)},useDebugValue:Dd,useDeferredValue:function(n){var e=Fn();return Rt===null?e.memoizedState=n:Sv(e,Rt.memoizedState,n)},useTransition:function(){var n=sf(sa)[0],e=Fn().memoizedState;return[n,e]},useMutableSource:av,useSyncExternalStore:lv,useId:Mv,unstable_isNewReconciler:!1};function Gn(n,e){if(n&&n.defaultProps){e=_t({},e),n=n.defaultProps;for(var t in n)e[t]===void 0&&(e[t]=n[t]);return e}return e}function zf(n,e,t,i){e=n.memoizedState,t=t(i,e),t=t==null?e:_t({},e,t),n.memoizedState=t,n.lanes===0&&(n.updateQueue.baseState=t)}var yc={isMounted:function(n){return(n=n._reactInternals)?kr(n)===n:!1},enqueueSetState:function(n,e,t){n=n._reactInternals;var i=tn(),r=nr(n),s=Si(i,r);s.payload=e,t!=null&&(s.callback=t),e=er(n,s,r),e!==null&&(qn(e,n,r,i),Ul(e,n,r))},enqueueReplaceState:function(n,e,t){n=n._reactInternals;var i=tn(),r=nr(n),s=Si(i,r);s.tag=1,s.payload=e,t!=null&&(s.callback=t),e=er(n,s,r),e!==null&&(qn(e,n,r,i),Ul(e,n,r))},enqueueForceUpdate:function(n,e){n=n._reactInternals;var t=tn(),i=nr(n),r=Si(t,i);r.tag=2,e!=null&&(r.callback=e),e=er(n,r,i),e!==null&&(qn(e,n,i,t),Ul(e,n,i))}};function Og(n,e,t,i,r,s,o){return n=n.stateNode,typeof n.shouldComponentUpdate=="function"?n.shouldComponentUpdate(i,s,o):e.prototype&&e.prototype.isPureReactComponent?!Qo(t,i)||!Qo(r,s):!0}function Av(n,e,t){var i=!1,r=sr,s=e.contextType;return typeof s=="object"&&s!==null?s=Un(s):(r=un(e)?Dr:Wt.current,i=e.contextTypes,s=(i=i!=null)?Ps(n,r):sr),e=new e(t,s),n.memoizedState=e.state!==null&&e.state!==void 0?e.state:null,e.updater=yc,n.stateNode=e,e._reactInternals=n,i&&(n=n.stateNode,n.__reactInternalMemoizedUnmaskedChildContext=r,n.__reactInternalMemoizedMaskedChildContext=s),e}function Bg(n,e,t,i){n=e.state,typeof e.componentWillReceiveProps=="function"&&e.componentWillReceiveProps(t,i),typeof e.UNSAFE_componentWillReceiveProps=="function"&&e.UNSAFE_componentWillReceiveProps(t,i),e.state!==n&&yc.enqueueReplaceState(e,e.state,null)}function Vf(n,e,t,i){var r=n.stateNode;r.props=t,r.state=n.memoizedState,r.refs={},Td(n);var s=e.contextType;typeof s=="object"&&s!==null?r.context=Un(s):(s=un(e)?Dr:Wt.current,r.context=Ps(n,s)),r.state=n.memoizedState,s=e.getDerivedStateFromProps,typeof s=="function"&&(zf(n,e,s,t),r.state=n.memoizedState),typeof e.getDerivedStateFromProps=="function"||typeof r.getSnapshotBeforeUpdate=="function"||typeof r.UNSAFE_componentWillMount!="function"&&typeof r.componentWillMount!="function"||(e=r.state,typeof r.componentWillMount=="function"&&r.componentWillMount(),typeof r.UNSAFE_componentWillMount=="function"&&r.UNSAFE_componentWillMount(),e!==r.state&&yc.enqueueReplaceState(r,r.state,null),ic(n,t,r,i),r.state=n.memoizedState),typeof r.componentDidMount=="function"&&(n.flags|=4194308)}function Ns(n,e){try{var t="",i=e;do t+=H_(i),i=i.return;while(i);var r=t}catch(s){r=`
Error generating stack: `+s.message+`
`+s.stack}return{value:n,source:e,stack:r,digest:null}}function of(n,e,t){return{value:n,source:null,stack:t??null,digest:e??null}}function Hf(n,e){try{console.error(e.value)}catch(t){setTimeout(function(){throw t})}}var dM=typeof WeakMap=="function"?WeakMap:Map;function bv(n,e,t){t=Si(-1,t),t.tag=3,t.payload={element:null};var i=e.value;return t.callback=function(){lc||(lc=!0,Qf=i),Hf(n,e)},t}function Cv(n,e,t){t=Si(-1,t),t.tag=3;var i=n.type.getDerivedStateFromError;if(typeof i=="function"){var r=e.value;t.payload=function(){return i(r)},t.callback=function(){Hf(n,e)}}var s=n.stateNode;return s!==null&&typeof s.componentDidCatch=="function"&&(t.callback=function(){Hf(n,e),typeof i!="function"&&(tr===null?tr=new Set([this]):tr.add(this));var o=e.stack;this.componentDidCatch(e.value,{componentStack:o!==null?o:""})}),t}function kg(n,e,t){var i=n.pingCache;if(i===null){i=n.pingCache=new dM;var r=new Set;i.set(e,r)}else r=i.get(e),r===void 0&&(r=new Set,i.set(e,r));r.has(t)||(r.add(t),n=bM.bind(null,n,e,t),e.then(n,n))}function zg(n){do{var e;if((e=n.tag===13)&&(e=n.memoizedState,e=e!==null?e.dehydrated!==null:!0),e)return n;n=n.return}while(n!==null);return null}function Vg(n,e,t,i,r){return(n.mode&1)===0?(n===e?n.flags|=65536:(n.flags|=128,t.flags|=131072,t.flags&=-52805,t.tag===1&&(t.alternate===null?t.tag=17:(e=Si(-1,1),e.tag=2,er(t,e,1))),t.lanes|=1),n):(n.flags|=65536,n.lanes=r,n)}var pM=Ai.ReactCurrentOwner,ln=!1;function en(n,e,t,i){e.child=n===null?iv(e,null,t,i):Ls(e,n.child,t,i)}function Hg(n,e,t,i,r){t=t.render;var s=e.ref;return bs(e,r),i=Pd(n,e,t,i,s,r),t=Id(),n!==null&&!ln?(e.updateQueue=n.updateQueue,e.flags&=-2053,n.lanes&=~r,Ti(n,e,r)):(mt&&t&&xd(e),e.flags|=1,en(n,e,i,r),e.child)}function Gg(n,e,t,i,r){if(n===null){var s=t.type;return typeof s=="function"&&!Vd(s)&&s.defaultProps===void 0&&t.compare===null&&t.defaultProps===void 0?(e.tag=15,e.type=s,Rv(n,e,s,i,r)):(n=Vl(t.type,null,i,e,e.mode,r),n.ref=e.ref,n.return=e,e.child=n)}if(s=n.child,(n.lanes&r)===0){var o=s.memoizedProps;if(t=t.compare,t=t!==null?t:Qo,t(o,i)&&n.ref===e.ref)return Ti(n,e,r)}return e.flags|=1,n=ir(s,i),n.ref=e.ref,n.return=e,e.child=n}function Rv(n,e,t,i,r){if(n!==null){var s=n.memoizedProps;if(Qo(s,i)&&n.ref===e.ref)if(ln=!1,e.pendingProps=i=s,(n.lanes&r)!==0)(n.flags&131072)!==0&&(ln=!0);else return e.lanes=n.lanes,Ti(n,e,r)}return Gf(n,e,t,i,r)}function Pv(n,e,t){var i=e.pendingProps,r=i.children,s=n!==null?n.memoizedState:null;if(i.mode==="hidden")if((e.mode&1)===0)e.memoizedState={baseLanes:0,cachePool:null,transitions:null},ut(Ms,vn),vn|=t;else{if((t&1073741824)===0)return n=s!==null?s.baseLanes|t:t,e.lanes=e.childLanes=1073741824,e.memoizedState={baseLanes:n,cachePool:null,transitions:null},e.updateQueue=null,ut(Ms,vn),vn|=n,null;e.memoizedState={baseLanes:0,cachePool:null,transitions:null},i=s!==null?s.baseLanes:t,ut(Ms,vn),vn|=i}else s!==null?(i=s.baseLanes|t,e.memoizedState=null):i=t,ut(Ms,vn),vn|=i;return en(n,e,r,t),e.child}function Iv(n,e){var t=e.ref;(n===null&&t!==null||n!==null&&n.ref!==t)&&(e.flags|=512,e.flags|=2097152)}function Gf(n,e,t,i,r){var s=un(t)?Dr:Wt.current;return s=Ps(e,s),bs(e,r),t=Pd(n,e,t,i,s,r),i=Id(),n!==null&&!ln?(e.updateQueue=n.updateQueue,e.flags&=-2053,n.lanes&=~r,Ti(n,e,r)):(mt&&i&&xd(e),e.flags|=1,en(n,e,t,r),e.child)}function Wg(n,e,t,i,r){if(un(t)){var s=!0;Ql(e)}else s=!1;if(bs(e,r),e.stateNode===null)Bl(n,e),Av(e,t,i),Vf(e,t,i,r),i=!0;else if(n===null){var o=e.stateNode,a=e.memoizedProps;o.props=a;var l=o.context,u=t.contextType;typeof u=="object"&&u!==null?u=Un(u):(u=un(t)?Dr:Wt.current,u=Ps(e,u));var h=t.getDerivedStateFromProps,c=typeof h=="function"||typeof o.getSnapshotBeforeUpdate=="function";c||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==i||l!==u)&&Bg(e,o,i,u),Xi=!1;var f=e.memoizedState;o.state=f,ic(e,i,o,r),l=e.memoizedState,a!==i||f!==l||cn.current||Xi?(typeof h=="function"&&(zf(e,t,h,i),l=e.memoizedState),(a=Xi||Og(e,t,a,i,f,l,u))?(c||typeof o.UNSAFE_componentWillMount!="function"&&typeof o.componentWillMount!="function"||(typeof o.componentWillMount=="function"&&o.componentWillMount(),typeof o.UNSAFE_componentWillMount=="function"&&o.UNSAFE_componentWillMount()),typeof o.componentDidMount=="function"&&(e.flags|=4194308)):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),e.memoizedProps=i,e.memoizedState=l),o.props=i,o.state=l,o.context=u,i=a):(typeof o.componentDidMount=="function"&&(e.flags|=4194308),i=!1)}else{o=e.stateNode,sv(n,e),a=e.memoizedProps,u=e.type===e.elementType?a:Gn(e.type,a),o.props=u,c=e.pendingProps,f=o.context,l=t.contextType,typeof l=="object"&&l!==null?l=Un(l):(l=un(t)?Dr:Wt.current,l=Ps(e,l));var d=t.getDerivedStateFromProps;(h=typeof d=="function"||typeof o.getSnapshotBeforeUpdate=="function")||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(a!==c||f!==l)&&Bg(e,o,i,l),Xi=!1,f=e.memoizedState,o.state=f,ic(e,i,o,r);var m=e.memoizedState;a!==c||f!==m||cn.current||Xi?(typeof d=="function"&&(zf(e,t,d,i),m=e.memoizedState),(u=Xi||Og(e,t,u,i,f,m,l)||!1)?(h||typeof o.UNSAFE_componentWillUpdate!="function"&&typeof o.componentWillUpdate!="function"||(typeof o.componentWillUpdate=="function"&&o.componentWillUpdate(i,m,l),typeof o.UNSAFE_componentWillUpdate=="function"&&o.UNSAFE_componentWillUpdate(i,m,l)),typeof o.componentDidUpdate=="function"&&(e.flags|=4),typeof o.getSnapshotBeforeUpdate=="function"&&(e.flags|=1024)):(typeof o.componentDidUpdate!="function"||a===n.memoizedProps&&f===n.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===n.memoizedProps&&f===n.memoizedState||(e.flags|=1024),e.memoizedProps=i,e.memoizedState=m),o.props=i,o.state=m,o.context=l,i=u):(typeof o.componentDidUpdate!="function"||a===n.memoizedProps&&f===n.memoizedState||(e.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||a===n.memoizedProps&&f===n.memoizedState||(e.flags|=1024),i=!1)}return Wf(n,e,t,i,s,r)}function Wf(n,e,t,i,r,s){Iv(n,e);var o=(e.flags&128)!==0;if(!i&&!o)return r&&Rg(e,t,!1),Ti(n,e,s);i=e.stateNode,pM.current=e;var a=o&&typeof t.getDerivedStateFromError!="function"?null:i.render();return e.flags|=1,n!==null&&o?(e.child=Ls(e,n.child,null,s),e.child=Ls(e,null,a,s)):en(n,e,a,s),e.memoizedState=i.state,r&&Rg(e,t,!0),e.child}function Lv(n){var e=n.stateNode;e.pendingContext?Cg(n,e.pendingContext,e.pendingContext!==e.context):e.context&&Cg(n,e.context,!1),Ad(n,e.containerInfo)}function Xg(n,e,t,i,r){return Is(),_d(r),e.flags|=256,en(n,e,t,i),e.child}var Xf={dehydrated:null,treeContext:null,retryLane:0};function Yf(n){return{baseLanes:n,cachePool:null,transitions:null}}function Dv(n,e,t){var i=e.pendingProps,r=xt.current,s=!1,o=(e.flags&128)!==0,a;if((a=o)||(a=n!==null&&n.memoizedState===null?!1:(r&2)!==0),a?(s=!0,e.flags&=-129):(n===null||n.memoizedState!==null)&&(r|=1),ut(xt,r&1),n===null)return Bf(e),n=e.memoizedState,n!==null&&(n=n.dehydrated,n!==null)?((e.mode&1)===0?e.lanes=1:n.data==="$!"?e.lanes=8:e.lanes=1073741824,null):(o=i.children,n=i.fallback,s?(i=e.mode,s=e.child,o={mode:"hidden",children:o},(i&1)===0&&s!==null?(s.childLanes=0,s.pendingProps=o):s=Mc(o,i,0,null),n=Lr(n,i,t,null),s.return=e,n.return=e,s.sibling=n,e.child=s,e.child.memoizedState=Yf(t),e.memoizedState=Xf,n):Nd(e,o));if(r=n.memoizedState,r!==null&&(a=r.dehydrated,a!==null))return mM(n,e,o,i,a,r,t);if(s){s=i.fallback,o=e.mode,r=n.child,a=r.sibling;var l={mode:"hidden",children:i.children};return(o&1)===0&&e.child!==r?(i=e.child,i.childLanes=0,i.pendingProps=l,e.deletions=null):(i=ir(r,l),i.subtreeFlags=r.subtreeFlags&14680064),a!==null?s=ir(a,s):(s=Lr(s,o,t,null),s.flags|=2),s.return=e,i.return=e,i.sibling=s,e.child=i,i=s,s=e.child,o=n.child.memoizedState,o=o===null?Yf(t):{baseLanes:o.baseLanes|t,cachePool:null,transitions:o.transitions},s.memoizedState=o,s.childLanes=n.childLanes&~t,e.memoizedState=Xf,i}return s=n.child,n=s.sibling,i=ir(s,{mode:"visible",children:i.children}),(e.mode&1)===0&&(i.lanes=t),i.return=e,i.sibling=null,n!==null&&(t=e.deletions,t===null?(e.deletions=[n],e.flags|=16):t.push(n)),e.child=i,e.memoizedState=null,i}function Nd(n,e){return e=Mc({mode:"visible",children:e},n.mode,0,null),e.return=n,n.child=e}function Rl(n,e,t,i){return i!==null&&_d(i),Ls(e,n.child,null,t),n=Nd(e,e.pendingProps.children),n.flags|=2,e.memoizedState=null,n}function mM(n,e,t,i,r,s,o){if(t)return e.flags&256?(e.flags&=-257,i=of(Error(ce(422))),Rl(n,e,o,i)):e.memoizedState!==null?(e.child=n.child,e.flags|=128,null):(s=i.fallback,r=e.mode,i=Mc({mode:"visible",children:i.children},r,0,null),s=Lr(s,r,o,null),s.flags|=2,i.return=e,s.return=e,i.sibling=s,e.child=i,(e.mode&1)!==0&&Ls(e,n.child,null,o),e.child.memoizedState=Yf(o),e.memoizedState=Xf,s);if((e.mode&1)===0)return Rl(n,e,o,null);if(r.data==="$!"){if(i=r.nextSibling&&r.nextSibling.dataset,i)var a=i.dgst;return i=a,s=Error(ce(419)),i=of(s,i,void 0),Rl(n,e,o,i)}if(a=(o&n.childLanes)!==0,ln||a){if(i=Nt,i!==null){switch(o&-o){case 4:r=2;break;case 16:r=8;break;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:r=32;break;case 536870912:r=268435456;break;default:r=0}r=(r&(i.suspendedLanes|o))!==0?0:r,r!==0&&r!==s.retryLane&&(s.retryLane=r,Ei(n,r),qn(i,n,r,-1))}return zd(),i=of(Error(ce(421))),Rl(n,e,o,i)}return r.data==="$?"?(e.flags|=128,e.child=n.child,e=CM.bind(null,n),r._reactRetry=e,null):(n=s.treeContext,xn=ji(r.nextSibling),yn=e,mt=!0,Xn=null,n!==null&&(In[Ln++]=yi,In[Ln++]=_i,In[Ln++]=Nr,yi=n.id,_i=n.overflow,Nr=e),e=Nd(e,i.children),e.flags|=4096,e)}function Yg(n,e,t){n.lanes|=e;var i=n.alternate;i!==null&&(i.lanes|=e),kf(n.return,e,t)}function af(n,e,t,i,r){var s=n.memoizedState;s===null?n.memoizedState={isBackwards:e,rendering:null,renderingStartTime:0,last:i,tail:t,tailMode:r}:(s.isBackwards=e,s.rendering=null,s.renderingStartTime=0,s.last=i,s.tail=t,s.tailMode=r)}function Nv(n,e,t){var i=e.pendingProps,r=i.revealOrder,s=i.tail;if(en(n,e,i.children,t),i=xt.current,(i&2)!==0)i=i&1|2,e.flags|=128;else{if(n!==null&&(n.flags&128)!==0)e:for(n=e.child;n!==null;){if(n.tag===13)n.memoizedState!==null&&Yg(n,t,e);else if(n.tag===19)Yg(n,t,e);else if(n.child!==null){n.child.return=n,n=n.child;continue}if(n===e)break e;for(;n.sibling===null;){if(n.return===null||n.return===e)break e;n=n.return}n.sibling.return=n.return,n=n.sibling}i&=1}if(ut(xt,i),(e.mode&1)===0)e.memoizedState=null;else switch(r){case"forwards":for(t=e.child,r=null;t!==null;)n=t.alternate,n!==null&&rc(n)===null&&(r=t),t=t.sibling;t=r,t===null?(r=e.child,e.child=null):(r=t.sibling,t.sibling=null),af(e,!1,r,t,s);break;case"backwards":for(t=null,r=e.child,e.child=null;r!==null;){if(n=r.alternate,n!==null&&rc(n)===null){e.child=r;break}n=r.sibling,r.sibling=t,t=r,r=n}af(e,!0,t,null,s);break;case"together":af(e,!1,null,null,void 0);break;default:e.memoizedState=null}return e.child}function Bl(n,e){(e.mode&1)===0&&n!==null&&(n.alternate=null,e.alternate=null,e.flags|=2)}function Ti(n,e,t){if(n!==null&&(e.dependencies=n.dependencies),Fr|=e.lanes,(t&e.childLanes)===0)return null;if(n!==null&&e.child!==n.child)throw Error(ce(153));if(e.child!==null){for(n=e.child,t=ir(n,n.pendingProps),e.child=t,t.return=e;n.sibling!==null;)n=n.sibling,t=t.sibling=ir(n,n.pendingProps),t.return=e;t.sibling=null}return e.child}function gM(n,e,t){switch(e.tag){case 3:Lv(e),Is();break;case 5:ov(e);break;case 1:un(e.type)&&Ql(e);break;case 4:Ad(e,e.stateNode.containerInfo);break;case 10:var i=e.type._context,r=e.memoizedProps.value;ut(tc,i._currentValue),i._currentValue=r;break;case 13:if(i=e.memoizedState,i!==null)return i.dehydrated!==null?(ut(xt,xt.current&1),e.flags|=128,null):(t&e.child.childLanes)!==0?Dv(n,e,t):(ut(xt,xt.current&1),n=Ti(n,e,t),n!==null?n.sibling:null);ut(xt,xt.current&1);break;case 19:if(i=(t&e.childLanes)!==0,(n.flags&128)!==0){if(i)return Nv(n,e,t);e.flags|=128}if(r=e.memoizedState,r!==null&&(r.rendering=null,r.tail=null,r.lastEffect=null),ut(xt,xt.current),i)break;return null;case 22:case 23:return e.lanes=0,Pv(n,e,t)}return Ti(n,e,t)}var Uv,qf,Fv,Ov;Uv=function(n,e){for(var t=e.child;t!==null;){if(t.tag===5||t.tag===6)n.appendChild(t.stateNode);else if(t.tag!==4&&t.child!==null){t.child.return=t,t=t.child;continue}if(t===e)break;for(;t.sibling===null;){if(t.return===null||t.return===e)return;t=t.return}t.sibling.return=t.return,t=t.sibling}};qf=function(){};Fv=function(n,e,t,i){var r=n.memoizedProps;if(r!==i){n=e.stateNode,Pr(ui.current);var s=null;switch(t){case"input":r=mf(n,r),i=mf(n,i),s=[];break;case"select":r=_t({},r,{value:void 0}),i=_t({},i,{value:void 0}),s=[];break;case"textarea":r=xf(n,r),i=xf(n,i),s=[];break;default:typeof r.onClick!="function"&&typeof i.onClick=="function"&&(n.onclick=Jl)}_f(t,i);var o;t=null;for(u in r)if(!i.hasOwnProperty(u)&&r.hasOwnProperty(u)&&r[u]!=null)if(u==="style"){var a=r[u];for(o in a)a.hasOwnProperty(o)&&(t||(t={}),t[o]="")}else u!=="dangerouslySetInnerHTML"&&u!=="children"&&u!=="suppressContentEditableWarning"&&u!=="suppressHydrationWarning"&&u!=="autoFocus"&&(Xo.hasOwnProperty(u)?s||(s=[]):(s=s||[]).push(u,null));for(u in i){var l=i[u];if(a=r?.[u],i.hasOwnProperty(u)&&l!==a&&(l!=null||a!=null))if(u==="style")if(a){for(o in a)!a.hasOwnProperty(o)||l&&l.hasOwnProperty(o)||(t||(t={}),t[o]="");for(o in l)l.hasOwnProperty(o)&&a[o]!==l[o]&&(t||(t={}),t[o]=l[o])}else t||(s||(s=[]),s.push(u,t)),t=l;else u==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,a=a?a.__html:void 0,l!=null&&a!==l&&(s=s||[]).push(u,l)):u==="children"?typeof l!="string"&&typeof l!="number"||(s=s||[]).push(u,""+l):u!=="suppressContentEditableWarning"&&u!=="suppressHydrationWarning"&&(Xo.hasOwnProperty(u)?(l!=null&&u==="onScroll"&&ft("scroll",n),s||a===l||(s=[])):(s=s||[]).push(u,l))}t&&(s=s||[]).push("style",t);var u=s;(e.updateQueue=u)&&(e.flags|=4)}};Ov=function(n,e,t,i){t!==i&&(e.flags|=4)};function Ro(n,e){if(!mt)switch(n.tailMode){case"hidden":e=n.tail;for(var t=null;e!==null;)e.alternate!==null&&(t=e),e=e.sibling;t===null?n.tail=null:t.sibling=null;break;case"collapsed":t=n.tail;for(var i=null;t!==null;)t.alternate!==null&&(i=t),t=t.sibling;i===null?e||n.tail===null?n.tail=null:n.tail.sibling=null:i.sibling=null}}function Ht(n){var e=n.alternate!==null&&n.alternate.child===n.child,t=0,i=0;if(e)for(var r=n.child;r!==null;)t|=r.lanes|r.childLanes,i|=r.subtreeFlags&14680064,i|=r.flags&14680064,r.return=n,r=r.sibling;else for(r=n.child;r!==null;)t|=r.lanes|r.childLanes,i|=r.subtreeFlags,i|=r.flags,r.return=n,r=r.sibling;return n.subtreeFlags|=i,n.childLanes=t,e}function vM(n,e,t){var i=e.pendingProps;switch(yd(e),e.tag){case 2:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return Ht(e),null;case 1:return un(e.type)&&Kl(),Ht(e),null;case 3:return i=e.stateNode,Ds(),dt(cn),dt(Wt),Cd(),i.pendingContext&&(i.context=i.pendingContext,i.pendingContext=null),(n===null||n.child===null)&&(bl(e)?e.flags|=4:n===null||n.memoizedState.isDehydrated&&(e.flags&256)===0||(e.flags|=1024,Xn!==null&&(td(Xn),Xn=null))),qf(n,e),Ht(e),null;case 5:bd(e);var r=Pr(ia.current);if(t=e.type,n!==null&&e.stateNode!=null)Fv(n,e,t,i,r),n.ref!==e.ref&&(e.flags|=512,e.flags|=2097152);else{if(!i){if(e.stateNode===null)throw Error(ce(166));return Ht(e),null}if(n=Pr(ui.current),bl(e)){i=e.stateNode,t=e.type;var s=e.memoizedProps;switch(i[li]=e,i[ta]=s,n=(e.mode&1)!==0,t){case"dialog":ft("cancel",i),ft("close",i);break;case"iframe":case"object":case"embed":ft("load",i);break;case"video":case"audio":for(r=0;r<Uo.length;r++)ft(Uo[r],i);break;case"source":ft("error",i);break;case"img":case"image":case"link":ft("error",i),ft("load",i);break;case"details":ft("toggle",i);break;case"input":eg(i,s),ft("invalid",i);break;case"select":i._wrapperState={wasMultiple:!!s.multiple},ft("invalid",i);break;case"textarea":ng(i,s),ft("invalid",i)}_f(t,s),r=null;for(var o in s)if(s.hasOwnProperty(o)){var a=s[o];o==="children"?typeof a=="string"?i.textContent!==a&&(s.suppressHydrationWarning!==!0&&Al(i.textContent,a,n),r=["children",a]):typeof a=="number"&&i.textContent!==""+a&&(s.suppressHydrationWarning!==!0&&Al(i.textContent,a,n),r=["children",""+a]):Xo.hasOwnProperty(o)&&a!=null&&o==="onScroll"&&ft("scroll",i)}switch(t){case"input":pl(i),tg(i,s,!0);break;case"textarea":pl(i),ig(i);break;case"select":case"option":break;default:typeof s.onClick=="function"&&(i.onclick=Jl)}i=r,e.updateQueue=i,i!==null&&(e.flags|=4)}else{o=r.nodeType===9?r:r.ownerDocument,n==="http://www.w3.org/1999/xhtml"&&(n=h0(t)),n==="http://www.w3.org/1999/xhtml"?t==="script"?(n=o.createElement("div"),n.innerHTML="<script><\/script>",n=n.removeChild(n.firstChild)):typeof i.is=="string"?n=o.createElement(t,{is:i.is}):(n=o.createElement(t),t==="select"&&(o=n,i.multiple?o.multiple=!0:i.size&&(o.size=i.size))):n=o.createElementNS(n,t),n[li]=e,n[ta]=i,Uv(n,e,!1,!1),e.stateNode=n;e:{switch(o=Sf(t,i),t){case"dialog":ft("cancel",n),ft("close",n),r=i;break;case"iframe":case"object":case"embed":ft("load",n),r=i;break;case"video":case"audio":for(r=0;r<Uo.length;r++)ft(Uo[r],n);r=i;break;case"source":ft("error",n),r=i;break;case"img":case"image":case"link":ft("error",n),ft("load",n),r=i;break;case"details":ft("toggle",n),r=i;break;case"input":eg(n,i),r=mf(n,i),ft("invalid",n);break;case"option":r=i;break;case"select":n._wrapperState={wasMultiple:!!i.multiple},r=_t({},i,{value:void 0}),ft("invalid",n);break;case"textarea":ng(n,i),r=xf(n,i),ft("invalid",n);break;default:r=i}_f(t,r),a=r;for(s in a)if(a.hasOwnProperty(s)){var l=a[s];s==="style"?p0(n,l):s==="dangerouslySetInnerHTML"?(l=l?l.__html:void 0,l!=null&&f0(n,l)):s==="children"?typeof l=="string"?(t!=="textarea"||l!=="")&&Yo(n,l):typeof l=="number"&&Yo(n,""+l):s!=="suppressContentEditableWarning"&&s!=="suppressHydrationWarning"&&s!=="autoFocus"&&(Xo.hasOwnProperty(s)?l!=null&&s==="onScroll"&&ft("scroll",n):l!=null&&rd(n,s,l,o))}switch(t){case"input":pl(n),tg(n,i,!1);break;case"textarea":pl(n),ig(n);break;case"option":i.value!=null&&n.setAttribute("value",""+rr(i.value));break;case"select":n.multiple=!!i.multiple,s=i.value,s!=null?ws(n,!!i.multiple,s,!1):i.defaultValue!=null&&ws(n,!!i.multiple,i.defaultValue,!0);break;default:typeof r.onClick=="function"&&(n.onclick=Jl)}switch(t){case"button":case"input":case"select":case"textarea":i=!!i.autoFocus;break e;case"img":i=!0;break e;default:i=!1}}i&&(e.flags|=4)}e.ref!==null&&(e.flags|=512,e.flags|=2097152)}return Ht(e),null;case 6:if(n&&e.stateNode!=null)Ov(n,e,n.memoizedProps,i);else{if(typeof i!="string"&&e.stateNode===null)throw Error(ce(166));if(t=Pr(ia.current),Pr(ui.current),bl(e)){if(i=e.stateNode,t=e.memoizedProps,i[li]=e,(s=i.nodeValue!==t)&&(n=yn,n!==null))switch(n.tag){case 3:Al(i.nodeValue,t,(n.mode&1)!==0);break;case 5:n.memoizedProps.suppressHydrationWarning!==!0&&Al(i.nodeValue,t,(n.mode&1)!==0)}s&&(e.flags|=4)}else i=(t.nodeType===9?t:t.ownerDocument).createTextNode(i),i[li]=e,e.stateNode=i}return Ht(e),null;case 13:if(dt(xt),i=e.memoizedState,n===null||n.memoizedState!==null&&n.memoizedState.dehydrated!==null){if(mt&&xn!==null&&(e.mode&1)!==0&&(e.flags&128)===0)tv(),Is(),e.flags|=98560,s=!1;else if(s=bl(e),i!==null&&i.dehydrated!==null){if(n===null){if(!s)throw Error(ce(318));if(s=e.memoizedState,s=s!==null?s.dehydrated:null,!s)throw Error(ce(317));s[li]=e}else Is(),(e.flags&128)===0&&(e.memoizedState=null),e.flags|=4;Ht(e),s=!1}else Xn!==null&&(td(Xn),Xn=null),s=!0;if(!s)return e.flags&65536?e:null}return(e.flags&128)!==0?(e.lanes=t,e):(i=i!==null,i!==(n!==null&&n.memoizedState!==null)&&i&&(e.child.flags|=8192,(e.mode&1)!==0&&(n===null||(xt.current&1)!==0?Pt===0&&(Pt=3):zd())),e.updateQueue!==null&&(e.flags|=4),Ht(e),null);case 4:return Ds(),qf(n,e),n===null&&jo(e.stateNode.containerInfo),Ht(e),null;case 10:return wd(e.type._context),Ht(e),null;case 17:return un(e.type)&&Kl(),Ht(e),null;case 19:if(dt(xt),s=e.memoizedState,s===null)return Ht(e),null;if(i=(e.flags&128)!==0,o=s.rendering,o===null)if(i)Ro(s,!1);else{if(Pt!==0||n!==null&&(n.flags&128)!==0)for(n=e.child;n!==null;){if(o=rc(n),o!==null){for(e.flags|=128,Ro(s,!1),i=o.updateQueue,i!==null&&(e.updateQueue=i,e.flags|=4),e.subtreeFlags=0,i=t,t=e.child;t!==null;)s=t,n=i,s.flags&=14680066,o=s.alternate,o===null?(s.childLanes=0,s.lanes=n,s.child=null,s.subtreeFlags=0,s.memoizedProps=null,s.memoizedState=null,s.updateQueue=null,s.dependencies=null,s.stateNode=null):(s.childLanes=o.childLanes,s.lanes=o.lanes,s.child=o.child,s.subtreeFlags=0,s.deletions=null,s.memoizedProps=o.memoizedProps,s.memoizedState=o.memoizedState,s.updateQueue=o.updateQueue,s.type=o.type,n=o.dependencies,s.dependencies=n===null?null:{lanes:n.lanes,firstContext:n.firstContext}),t=t.sibling;return ut(xt,xt.current&1|2),e.child}n=n.sibling}s.tail!==null&&At()>Us&&(e.flags|=128,i=!0,Ro(s,!1),e.lanes=4194304)}else{if(!i)if(n=rc(o),n!==null){if(e.flags|=128,i=!0,t=n.updateQueue,t!==null&&(e.updateQueue=t,e.flags|=4),Ro(s,!0),s.tail===null&&s.tailMode==="hidden"&&!o.alternate&&!mt)return Ht(e),null}else 2*At()-s.renderingStartTime>Us&&t!==1073741824&&(e.flags|=128,i=!0,Ro(s,!1),e.lanes=4194304);s.isBackwards?(o.sibling=e.child,e.child=o):(t=s.last,t!==null?t.sibling=o:e.child=o,s.last=o)}return s.tail!==null?(e=s.tail,s.rendering=e,s.tail=e.sibling,s.renderingStartTime=At(),e.sibling=null,t=xt.current,ut(xt,i?t&1|2:t&1),e):(Ht(e),null);case 22:case 23:return kd(),i=e.memoizedState!==null,n!==null&&n.memoizedState!==null!==i&&(e.flags|=8192),i&&(e.mode&1)!==0?(vn&1073741824)!==0&&(Ht(e),e.subtreeFlags&6&&(e.flags|=8192)):Ht(e),null;case 24:return null;case 25:return null}throw Error(ce(156,e.tag))}function xM(n,e){switch(yd(e),e.tag){case 1:return un(e.type)&&Kl(),n=e.flags,n&65536?(e.flags=n&-65537|128,e):null;case 3:return Ds(),dt(cn),dt(Wt),Cd(),n=e.flags,(n&65536)!==0&&(n&128)===0?(e.flags=n&-65537|128,e):null;case 5:return bd(e),null;case 13:if(dt(xt),n=e.memoizedState,n!==null&&n.dehydrated!==null){if(e.alternate===null)throw Error(ce(340));Is()}return n=e.flags,n&65536?(e.flags=n&-65537|128,e):null;case 19:return dt(xt),null;case 4:return Ds(),null;case 10:return wd(e.type._context),null;case 22:case 23:return kd(),null;case 24:return null;default:return null}}var Pl=!1,Gt=!1,yM=typeof WeakSet=="function"?WeakSet:Set,Me=null;function Ss(n,e){var t=n.ref;if(t!==null)if(typeof t=="function")try{t(null)}catch(i){Tt(n,e,i)}else t.current=null}function $f(n,e,t){try{t()}catch(i){Tt(n,e,i)}}var qg=!1;function _M(n,e){if(If=ql,n=H0(),vd(n)){if("selectionStart"in n)var t={start:n.selectionStart,end:n.selectionEnd};else e:{t=(t=n.ownerDocument)&&t.defaultView||window;var i=t.getSelection&&t.getSelection();if(i&&i.rangeCount!==0){t=i.anchorNode;var r=i.anchorOffset,s=i.focusNode;i=i.focusOffset;try{t.nodeType,s.nodeType}catch{t=null;break e}var o=0,a=-1,l=-1,u=0,h=0,c=n,f=null;t:for(;;){for(var d;c!==t||r!==0&&c.nodeType!==3||(a=o+r),c!==s||i!==0&&c.nodeType!==3||(l=o+i),c.nodeType===3&&(o+=c.nodeValue.length),(d=c.firstChild)!==null;)f=c,c=d;for(;;){if(c===n)break t;if(f===t&&++u===r&&(a=o),f===s&&++h===i&&(l=o),(d=c.nextSibling)!==null)break;c=f,f=c.parentNode}c=d}t=a===-1||l===-1?null:{start:a,end:l}}else t=null}t=t||{start:0,end:0}}else t=null;for(Lf={focusedElem:n,selectionRange:t},ql=!1,Me=e;Me!==null;)if(e=Me,n=e.child,(e.subtreeFlags&1028)!==0&&n!==null)n.return=e,Me=n;else for(;Me!==null;){e=Me;try{var m=e.alternate;if((e.flags&1024)!==0)switch(e.tag){case 0:case 11:case 15:break;case 1:if(m!==null){var x=m.memoizedProps,y=m.memoizedState,p=e.stateNode,_=p.getSnapshotBeforeUpdate(e.elementType===e.type?x:Gn(e.type,x),y);p.__reactInternalSnapshotBeforeUpdate=_}break;case 3:var g=e.stateNode.containerInfo;g.nodeType===1?g.textContent="":g.nodeType===9&&g.documentElement&&g.removeChild(g.documentElement);break;case 5:case 6:case 4:case 17:break;default:throw Error(ce(163))}}catch(v){Tt(e,e.return,v)}if(n=e.sibling,n!==null){n.return=e.return,Me=n;break}Me=e.return}return m=qg,qg=!1,m}function Ho(n,e,t){var i=e.updateQueue;if(i=i!==null?i.lastEffect:null,i!==null){var r=i=i.next;do{if((r.tag&n)===n){var s=r.destroy;r.destroy=void 0,s!==void 0&&$f(e,t,s)}r=r.next}while(r!==i)}}function _c(n,e){if(e=e.updateQueue,e=e!==null?e.lastEffect:null,e!==null){var t=e=e.next;do{if((t.tag&n)===n){var i=t.create;t.destroy=i()}t=t.next}while(t!==e)}}function Zf(n){var e=n.ref;if(e!==null){var t=n.stateNode;switch(n.tag){case 5:n=t;break;default:n=t}typeof e=="function"?e(n):e.current=n}}function Bv(n){var e=n.alternate;e!==null&&(n.alternate=null,Bv(e)),n.child=null,n.deletions=null,n.sibling=null,n.tag===5&&(e=n.stateNode,e!==null&&(delete e[li],delete e[ta],delete e[Uf],delete e[nM],delete e[iM])),n.stateNode=null,n.return=null,n.dependencies=null,n.memoizedProps=null,n.memoizedState=null,n.pendingProps=null,n.stateNode=null,n.updateQueue=null}function kv(n){return n.tag===5||n.tag===3||n.tag===4}function $g(n){e:for(;;){for(;n.sibling===null;){if(n.return===null||kv(n.return))return null;n=n.return}for(n.sibling.return=n.return,n=n.sibling;n.tag!==5&&n.tag!==6&&n.tag!==18;){if(n.flags&2||n.child===null||n.tag===4)continue e;n.child.return=n,n=n.child}if(!(n.flags&2))return n.stateNode}}function Jf(n,e,t){var i=n.tag;if(i===5||i===6)n=n.stateNode,e?t.nodeType===8?t.parentNode.insertBefore(n,e):t.insertBefore(n,e):(t.nodeType===8?(e=t.parentNode,e.insertBefore(n,t)):(e=t,e.appendChild(n)),t=t._reactRootContainer,t!=null||e.onclick!==null||(e.onclick=Jl));else if(i!==4&&(n=n.child,n!==null))for(Jf(n,e,t),n=n.sibling;n!==null;)Jf(n,e,t),n=n.sibling}function Kf(n,e,t){var i=n.tag;if(i===5||i===6)n=n.stateNode,e?t.insertBefore(n,e):t.appendChild(n);else if(i!==4&&(n=n.child,n!==null))for(Kf(n,e,t),n=n.sibling;n!==null;)Kf(n,e,t),n=n.sibling}var Ot=null,Wn=!1;function Gi(n,e,t){for(t=t.child;t!==null;)zv(n,e,t),t=t.sibling}function zv(n,e,t){if(ci&&typeof ci.onCommitFiberUnmount=="function")try{ci.onCommitFiberUnmount(fc,t)}catch{}switch(t.tag){case 5:Gt||Ss(t,e);case 6:var i=Ot,r=Wn;Ot=null,Gi(n,e,t),Ot=i,Wn=r,Ot!==null&&(Wn?(n=Ot,t=t.stateNode,n.nodeType===8?n.parentNode.removeChild(t):n.removeChild(t)):Ot.removeChild(t.stateNode));break;case 18:Ot!==null&&(Wn?(n=Ot,t=t.stateNode,n.nodeType===8?jh(n.parentNode,t):n.nodeType===1&&jh(n,t),Jo(n)):jh(Ot,t.stateNode));break;case 4:i=Ot,r=Wn,Ot=t.stateNode.containerInfo,Wn=!0,Gi(n,e,t),Ot=i,Wn=r;break;case 0:case 11:case 14:case 15:if(!Gt&&(i=t.updateQueue,i!==null&&(i=i.lastEffect,i!==null))){r=i=i.next;do{var s=r,o=s.destroy;s=s.tag,o!==void 0&&((s&2)!==0||(s&4)!==0)&&$f(t,e,o),r=r.next}while(r!==i)}Gi(n,e,t);break;case 1:if(!Gt&&(Ss(t,e),i=t.stateNode,typeof i.componentWillUnmount=="function"))try{i.props=t.memoizedProps,i.state=t.memoizedState,i.componentWillUnmount()}catch(a){Tt(t,e,a)}Gi(n,e,t);break;case 21:Gi(n,e,t);break;case 22:t.mode&1?(Gt=(i=Gt)||t.memoizedState!==null,Gi(n,e,t),Gt=i):Gi(n,e,t);break;default:Gi(n,e,t)}}function Zg(n){var e=n.updateQueue;if(e!==null){n.updateQueue=null;var t=n.stateNode;t===null&&(t=n.stateNode=new yM),e.forEach(function(i){var r=RM.bind(null,n,i);t.has(i)||(t.add(i),i.then(r,r))})}}function Hn(n,e){var t=e.deletions;if(t!==null)for(var i=0;i<t.length;i++){var r=t[i];try{var s=n,o=e,a=o;e:for(;a!==null;){switch(a.tag){case 5:Ot=a.stateNode,Wn=!1;break e;case 3:Ot=a.stateNode.containerInfo,Wn=!0;break e;case 4:Ot=a.stateNode.containerInfo,Wn=!0;break e}a=a.return}if(Ot===null)throw Error(ce(160));zv(s,o,r),Ot=null,Wn=!1;var l=r.alternate;l!==null&&(l.return=null),r.return=null}catch(u){Tt(r,e,u)}}if(e.subtreeFlags&12854)for(e=e.child;e!==null;)Vv(e,n),e=e.sibling}function Vv(n,e){var t=n.alternate,i=n.flags;switch(n.tag){case 0:case 11:case 14:case 15:if(Hn(e,n),oi(n),i&4){try{Ho(3,n,n.return),_c(3,n)}catch(x){Tt(n,n.return,x)}try{Ho(5,n,n.return)}catch(x){Tt(n,n.return,x)}}break;case 1:Hn(e,n),oi(n),i&512&&t!==null&&Ss(t,t.return);break;case 5:if(Hn(e,n),oi(n),i&512&&t!==null&&Ss(t,t.return),n.flags&32){var r=n.stateNode;try{Yo(r,"")}catch(x){Tt(n,n.return,x)}}if(i&4&&(r=n.stateNode,r!=null)){var s=n.memoizedProps,o=t!==null?t.memoizedProps:s,a=n.type,l=n.updateQueue;if(n.updateQueue=null,l!==null)try{a==="input"&&s.type==="radio"&&s.name!=null&&c0(r,s),Sf(a,o);var u=Sf(a,s);for(o=0;o<l.length;o+=2){var h=l[o],c=l[o+1];h==="style"?p0(r,c):h==="dangerouslySetInnerHTML"?f0(r,c):h==="children"?Yo(r,c):rd(r,h,c,u)}switch(a){case"input":gf(r,s);break;case"textarea":u0(r,s);break;case"select":var f=r._wrapperState.wasMultiple;r._wrapperState.wasMultiple=!!s.multiple;var d=s.value;d!=null?ws(r,!!s.multiple,d,!1):f!==!!s.multiple&&(s.defaultValue!=null?ws(r,!!s.multiple,s.defaultValue,!0):ws(r,!!s.multiple,s.multiple?[]:"",!1))}r[ta]=s}catch(x){Tt(n,n.return,x)}}break;case 6:if(Hn(e,n),oi(n),i&4){if(n.stateNode===null)throw Error(ce(162));r=n.stateNode,s=n.memoizedProps;try{r.nodeValue=s}catch(x){Tt(n,n.return,x)}}break;case 3:if(Hn(e,n),oi(n),i&4&&t!==null&&t.memoizedState.isDehydrated)try{Jo(e.containerInfo)}catch(x){Tt(n,n.return,x)}break;case 4:Hn(e,n),oi(n);break;case 13:Hn(e,n),oi(n),r=n.child,r.flags&8192&&(s=r.memoizedState!==null,r.stateNode.isHidden=s,!s||r.alternate!==null&&r.alternate.memoizedState!==null||(Od=At())),i&4&&Zg(n);break;case 22:if(h=t!==null&&t.memoizedState!==null,n.mode&1?(Gt=(u=Gt)||h,Hn(e,n),Gt=u):Hn(e,n),oi(n),i&8192){if(u=n.memoizedState!==null,(n.stateNode.isHidden=u)&&!h&&(n.mode&1)!==0)for(Me=n,h=n.child;h!==null;){for(c=Me=h;Me!==null;){switch(f=Me,d=f.child,f.tag){case 0:case 11:case 14:case 15:Ho(4,f,f.return);break;case 1:Ss(f,f.return);var m=f.stateNode;if(typeof m.componentWillUnmount=="function"){i=f,t=f.return;try{e=i,m.props=e.memoizedProps,m.state=e.memoizedState,m.componentWillUnmount()}catch(x){Tt(i,t,x)}}break;case 5:Ss(f,f.return);break;case 22:if(f.memoizedState!==null){Kg(c);continue}}d!==null?(d.return=f,Me=d):Kg(c)}h=h.sibling}e:for(h=null,c=n;;){if(c.tag===5){if(h===null){h=c;try{r=c.stateNode,u?(s=r.style,typeof s.setProperty=="function"?s.setProperty("display","none","important"):s.display="none"):(a=c.stateNode,l=c.memoizedProps.style,o=l!=null&&l.hasOwnProperty("display")?l.display:null,a.style.display=d0("display",o))}catch(x){Tt(n,n.return,x)}}}else if(c.tag===6){if(h===null)try{c.stateNode.nodeValue=u?"":c.memoizedProps}catch(x){Tt(n,n.return,x)}}else if((c.tag!==22&&c.tag!==23||c.memoizedState===null||c===n)&&c.child!==null){c.child.return=c,c=c.child;continue}if(c===n)break e;for(;c.sibling===null;){if(c.return===null||c.return===n)break e;h===c&&(h=null),c=c.return}h===c&&(h=null),c.sibling.return=c.return,c=c.sibling}}break;case 19:Hn(e,n),oi(n),i&4&&Zg(n);break;case 21:break;default:Hn(e,n),oi(n)}}function oi(n){var e=n.flags;if(e&2){try{e:{for(var t=n.return;t!==null;){if(kv(t)){var i=t;break e}t=t.return}throw Error(ce(160))}switch(i.tag){case 5:var r=i.stateNode;i.flags&32&&(Yo(r,""),i.flags&=-33);var s=$g(n);Kf(n,s,r);break;case 3:case 4:var o=i.stateNode.containerInfo,a=$g(n);Jf(n,a,o);break;default:throw Error(ce(161))}}catch(l){Tt(n,n.return,l)}n.flags&=-3}e&4096&&(n.flags&=-4097)}function SM(n,e,t){Me=n,Hv(n,e,t)}function Hv(n,e,t){for(var i=(n.mode&1)!==0;Me!==null;){var r=Me,s=r.child;if(r.tag===22&&i){var o=r.memoizedState!==null||Pl;if(!o){var a=r.alternate,l=a!==null&&a.memoizedState!==null||Gt;a=Pl;var u=Gt;if(Pl=o,(Gt=l)&&!u)for(Me=r;Me!==null;)o=Me,l=o.child,o.tag===22&&o.memoizedState!==null?Qg(r):l!==null?(l.return=o,Me=l):Qg(r);for(;s!==null;)Me=s,Hv(s,e,t),s=s.sibling;Me=r,Pl=a,Gt=u}Jg(n,e,t)}else(r.subtreeFlags&8772)!==0&&s!==null?(s.return=r,Me=s):Jg(n,e,t)}}function Jg(n){for(;Me!==null;){var e=Me;if((e.flags&8772)!==0){var t=e.alternate;try{if((e.flags&8772)!==0)switch(e.tag){case 0:case 11:case 15:Gt||_c(5,e);break;case 1:var i=e.stateNode;if(e.flags&4&&!Gt)if(t===null)i.componentDidMount();else{var r=e.elementType===e.type?t.memoizedProps:Gn(e.type,t.memoizedProps);i.componentDidUpdate(r,t.memoizedState,i.__reactInternalSnapshotBeforeUpdate)}var s=e.updateQueue;s!==null&&Ng(e,s,i);break;case 3:var o=e.updateQueue;if(o!==null){if(t=null,e.child!==null)switch(e.child.tag){case 5:t=e.child.stateNode;break;case 1:t=e.child.stateNode}Ng(e,o,t)}break;case 5:var a=e.stateNode;if(t===null&&e.flags&4){t=a;var l=e.memoizedProps;switch(e.type){case"button":case"input":case"select":case"textarea":l.autoFocus&&t.focus();break;case"img":l.src&&(t.src=l.src)}}break;case 6:break;case 4:break;case 12:break;case 13:if(e.memoizedState===null){var u=e.alternate;if(u!==null){var h=u.memoizedState;if(h!==null){var c=h.dehydrated;c!==null&&Jo(c)}}}break;case 19:case 17:case 21:case 22:case 23:case 25:break;default:throw Error(ce(163))}Gt||e.flags&512&&Zf(e)}catch(f){Tt(e,e.return,f)}}if(e===n){Me=null;break}if(t=e.sibling,t!==null){t.return=e.return,Me=t;break}Me=e.return}}function Kg(n){for(;Me!==null;){var e=Me;if(e===n){Me=null;break}var t=e.sibling;if(t!==null){t.return=e.return,Me=t;break}Me=e.return}}function Qg(n){for(;Me!==null;){var e=Me;try{switch(e.tag){case 0:case 11:case 15:var t=e.return;try{_c(4,e)}catch(l){Tt(e,t,l)}break;case 1:var i=e.stateNode;if(typeof i.componentDidMount=="function"){var r=e.return;try{i.componentDidMount()}catch(l){Tt(e,r,l)}}var s=e.return;try{Zf(e)}catch(l){Tt(e,s,l)}break;case 5:var o=e.return;try{Zf(e)}catch(l){Tt(e,o,l)}}}catch(l){Tt(e,e.return,l)}if(e===n){Me=null;break}var a=e.sibling;if(a!==null){a.return=e.return,Me=a;break}Me=e.return}}var MM=Math.ceil,ac=Ai.ReactCurrentDispatcher,Ud=Ai.ReactCurrentOwner,Nn=Ai.ReactCurrentBatchConfig,et=0,Nt=null,bt=null,Bt=0,vn=0,Ms=ar(0),Pt=0,aa=null,Fr=0,Sc=0,Fd=0,Go=null,an=null,Od=0,Us=1/0,vi=null,lc=!1,Qf=null,tr=null,Il=!1,Zi=null,cc=0,Wo=0,jf=null,kl=-1,zl=0;function tn(){return(et&6)!==0?At():kl!==-1?kl:kl=At()}function nr(n){return(n.mode&1)===0?1:(et&2)!==0&&Bt!==0?Bt&-Bt:sM.transition!==null?(zl===0&&(zl=A0()),zl):(n=rt,n!==0||(n=window.event,n=n===void 0?16:D0(n.type)),n)}function qn(n,e,t,i){if(50<Wo)throw Wo=0,jf=null,Error(ce(185));la(n,t,i),((et&2)===0||n!==Nt)&&(n===Nt&&((et&2)===0&&(Sc|=t),Pt===4&&qi(n,Bt)),hn(n,i),t===1&&et===0&&(e.mode&1)===0&&(Us=At()+500,vc&&lr()))}function hn(n,e){var t=n.callbackNode;aS(n,e);var i=Yl(n,n===Nt?Bt:0);if(i===0)t!==null&&og(t),n.callbackNode=null,n.callbackPriority=0;else if(e=i&-i,n.callbackPriority!==e){if(t!=null&&og(t),e===1)n.tag===0?rM(jg.bind(null,n)):Q0(jg.bind(null,n)),eM(function(){(et&6)===0&&lr()}),t=null;else{switch(b0(i)){case 1:t=cd;break;case 4:t=E0;break;case 16:t=Xl;break;case 536870912:t=T0;break;default:t=Xl}t=Jv(t,Gv.bind(null,n))}n.callbackPriority=e,n.callbackNode=t}}function Gv(n,e){if(kl=-1,zl=0,(et&6)!==0)throw Error(ce(327));var t=n.callbackNode;if(Cs()&&n.callbackNode!==t)return null;var i=Yl(n,n===Nt?Bt:0);if(i===0)return null;if((i&30)!==0||(i&n.expiredLanes)!==0||e)e=uc(n,i);else{e=i;var r=et;et|=2;var s=Xv();(Nt!==n||Bt!==e)&&(vi=null,Us=At()+500,Ir(n,e));do try{TM();break}catch(a){Wv(n,a)}while(!0);Md(),ac.current=s,et=r,bt!==null?e=0:(Nt=null,Bt=0,e=Pt)}if(e!==0){if(e===2&&(r=Af(n),r!==0&&(i=r,e=ed(n,r))),e===1)throw t=aa,Ir(n,0),qi(n,i),hn(n,At()),t;if(e===6)qi(n,i);else{if(r=n.current.alternate,(i&30)===0&&!wM(r)&&(e=uc(n,i),e===2&&(s=Af(n),s!==0&&(i=s,e=ed(n,s))),e===1))throw t=aa,Ir(n,0),qi(n,i),hn(n,At()),t;switch(n.finishedWork=r,n.finishedLanes=i,e){case 0:case 1:throw Error(ce(345));case 2:br(n,an,vi);break;case 3:if(qi(n,i),(i&130023424)===i&&(e=Od+500-At(),10<e)){if(Yl(n,0)!==0)break;if(r=n.suspendedLanes,(r&i)!==i){tn(),n.pingedLanes|=n.suspendedLanes&r;break}n.timeoutHandle=Nf(br.bind(null,n,an,vi),e);break}br(n,an,vi);break;case 4:if(qi(n,i),(i&4194240)===i)break;for(e=n.eventTimes,r=-1;0<i;){var o=31-Yn(i);s=1<<o,o=e[o],o>r&&(r=o),i&=~s}if(i=r,i=At()-i,i=(120>i?120:480>i?480:1080>i?1080:1920>i?1920:3e3>i?3e3:4320>i?4320:1960*MM(i/1960))-i,10<i){n.timeoutHandle=Nf(br.bind(null,n,an,vi),i);break}br(n,an,vi);break;case 5:br(n,an,vi);break;default:throw Error(ce(329))}}}return hn(n,At()),n.callbackNode===t?Gv.bind(null,n):null}function ed(n,e){var t=Go;return n.current.memoizedState.isDehydrated&&(Ir(n,e).flags|=256),n=uc(n,e),n!==2&&(e=an,an=t,e!==null&&td(e)),n}function td(n){an===null?an=n:an.push.apply(an,n)}function wM(n){for(var e=n;;){if(e.flags&16384){var t=e.updateQueue;if(t!==null&&(t=t.stores,t!==null))for(var i=0;i<t.length;i++){var r=t[i],s=r.getSnapshot;r=r.value;try{if(!$n(s(),r))return!1}catch{return!1}}}if(t=e.child,e.subtreeFlags&16384&&t!==null)t.return=e,e=t;else{if(e===n)break;for(;e.sibling===null;){if(e.return===null||e.return===n)return!0;e=e.return}e.sibling.return=e.return,e=e.sibling}}return!0}function qi(n,e){for(e&=~Fd,e&=~Sc,n.suspendedLanes|=e,n.pingedLanes&=~e,n=n.expirationTimes;0<e;){var t=31-Yn(e),i=1<<t;n[t]=-1,e&=~i}}function jg(n){if((et&6)!==0)throw Error(ce(327));Cs();var e=Yl(n,0);if((e&1)===0)return hn(n,At()),null;var t=uc(n,e);if(n.tag!==0&&t===2){var i=Af(n);i!==0&&(e=i,t=ed(n,i))}if(t===1)throw t=aa,Ir(n,0),qi(n,e),hn(n,At()),t;if(t===6)throw Error(ce(345));return n.finishedWork=n.current.alternate,n.finishedLanes=e,br(n,an,vi),hn(n,At()),null}function Bd(n,e){var t=et;et|=1;try{return n(e)}finally{et=t,et===0&&(Us=At()+500,vc&&lr())}}function Or(n){Zi!==null&&Zi.tag===0&&(et&6)===0&&Cs();var e=et;et|=1;var t=Nn.transition,i=rt;try{if(Nn.transition=null,rt=1,n)return n()}finally{rt=i,Nn.transition=t,et=e,(et&6)===0&&lr()}}function kd(){vn=Ms.current,dt(Ms)}function Ir(n,e){n.finishedWork=null,n.finishedLanes=0;var t=n.timeoutHandle;if(t!==-1&&(n.timeoutHandle=-1,jS(t)),bt!==null)for(t=bt.return;t!==null;){var i=t;switch(yd(i),i.tag){case 1:i=i.type.childContextTypes,i!=null&&Kl();break;case 3:Ds(),dt(cn),dt(Wt),Cd();break;case 5:bd(i);break;case 4:Ds();break;case 13:dt(xt);break;case 19:dt(xt);break;case 10:wd(i.type._context);break;case 22:case 23:kd()}t=t.return}if(Nt=n,bt=n=ir(n.current,null),Bt=vn=e,Pt=0,aa=null,Fd=Sc=Fr=0,an=Go=null,Rr!==null){for(e=0;e<Rr.length;e++)if(t=Rr[e],i=t.interleaved,i!==null){t.interleaved=null;var r=i.next,s=t.pending;if(s!==null){var o=s.next;s.next=r,i.next=o}t.pending=i}Rr=null}return n}function Wv(n,e){do{var t=bt;try{if(Md(),Fl.current=oc,sc){for(var i=yt.memoizedState;i!==null;){var r=i.queue;r!==null&&(r.pending=null),i=i.next}sc=!1}if(Ur=0,Dt=Rt=yt=null,Vo=!1,ra=0,Ud.current=null,t===null||t.return===null){Pt=1,aa=e,bt=null;break}e:{var s=n,o=t.return,a=t,l=e;if(e=Bt,a.flags|=32768,l!==null&&typeof l=="object"&&typeof l.then=="function"){var u=l,h=a,c=h.tag;if((h.mode&1)===0&&(c===0||c===11||c===15)){var f=h.alternate;f?(h.updateQueue=f.updateQueue,h.memoizedState=f.memoizedState,h.lanes=f.lanes):(h.updateQueue=null,h.memoizedState=null)}var d=zg(o);if(d!==null){d.flags&=-257,Vg(d,o,a,s,e),d.mode&1&&kg(s,u,e),e=d,l=u;var m=e.updateQueue;if(m===null){var x=new Set;x.add(l),e.updateQueue=x}else m.add(l);break e}else{if((e&1)===0){kg(s,u,e),zd();break e}l=Error(ce(426))}}else if(mt&&a.mode&1){var y=zg(o);if(y!==null){(y.flags&65536)===0&&(y.flags|=256),Vg(y,o,a,s,e),_d(Ns(l,a));break e}}s=l=Ns(l,a),Pt!==4&&(Pt=2),Go===null?Go=[s]:Go.push(s),s=o;do{switch(s.tag){case 3:s.flags|=65536,e&=-e,s.lanes|=e;var p=bv(s,l,e);Dg(s,p);break e;case 1:a=l;var _=s.type,g=s.stateNode;if((s.flags&128)===0&&(typeof _.getDerivedStateFromError=="function"||g!==null&&typeof g.componentDidCatch=="function"&&(tr===null||!tr.has(g)))){s.flags|=65536,e&=-e,s.lanes|=e;var v=Cv(s,a,e);Dg(s,v);break e}}s=s.return}while(s!==null)}qv(t)}catch(M){e=M,bt===t&&t!==null&&(bt=t=t.return);continue}break}while(!0)}function Xv(){var n=ac.current;return ac.current=oc,n===null?oc:n}function zd(){(Pt===0||Pt===3||Pt===2)&&(Pt=4),Nt===null||(Fr&268435455)===0&&(Sc&268435455)===0||qi(Nt,Bt)}function uc(n,e){var t=et;et|=2;var i=Xv();(Nt!==n||Bt!==e)&&(vi=null,Ir(n,e));do try{EM();break}catch(r){Wv(n,r)}while(!0);if(Md(),et=t,ac.current=i,bt!==null)throw Error(ce(261));return Nt=null,Bt=0,Pt}function EM(){for(;bt!==null;)Yv(bt)}function TM(){for(;bt!==null&&!Q_();)Yv(bt)}function Yv(n){var e=Zv(n.alternate,n,vn);n.memoizedProps=n.pendingProps,e===null?qv(n):bt=e,Ud.current=null}function qv(n){var e=n;do{var t=e.alternate;if(n=e.return,(e.flags&32768)===0){if(t=vM(t,e,vn),t!==null){bt=t;return}}else{if(t=xM(t,e),t!==null){t.flags&=32767,bt=t;return}if(n!==null)n.flags|=32768,n.subtreeFlags=0,n.deletions=null;else{Pt=6,bt=null;return}}if(e=e.sibling,e!==null){bt=e;return}bt=e=n}while(e!==null);Pt===0&&(Pt=5)}function br(n,e,t){var i=rt,r=Nn.transition;try{Nn.transition=null,rt=1,AM(n,e,t,i)}finally{Nn.transition=r,rt=i}return null}function AM(n,e,t,i){do Cs();while(Zi!==null);if((et&6)!==0)throw Error(ce(327));t=n.finishedWork;var r=n.finishedLanes;if(t===null)return null;if(n.finishedWork=null,n.finishedLanes=0,t===n.current)throw Error(ce(177));n.callbackNode=null,n.callbackPriority=0;var s=t.lanes|t.childLanes;if(lS(n,s),n===Nt&&(bt=Nt=null,Bt=0),(t.subtreeFlags&2064)===0&&(t.flags&2064)===0||Il||(Il=!0,Jv(Xl,function(){return Cs(),null})),s=(t.flags&15990)!==0,(t.subtreeFlags&15990)!==0||s){s=Nn.transition,Nn.transition=null;var o=rt;rt=1;var a=et;et|=4,Ud.current=null,_M(n,t),Vv(t,n),$S(Lf),ql=!!If,Lf=If=null,n.current=t,SM(t,n,r),j_(),et=a,rt=o,Nn.transition=s}else n.current=t;if(Il&&(Il=!1,Zi=n,cc=r),s=n.pendingLanes,s===0&&(tr=null),nS(t.stateNode,i),hn(n,At()),e!==null)for(i=n.onRecoverableError,t=0;t<e.length;t++)r=e[t],i(r.value,{componentStack:r.stack,digest:r.digest});if(lc)throw lc=!1,n=Qf,Qf=null,n;return(cc&1)!==0&&n.tag!==0&&Cs(),s=n.pendingLanes,(s&1)!==0?n===jf?Wo++:(Wo=0,jf=n):Wo=0,lr(),null}function Cs(){if(Zi!==null){var n=b0(cc),e=Nn.transition,t=rt;try{if(Nn.transition=null,rt=16>n?16:n,Zi===null)var i=!1;else{if(n=Zi,Zi=null,cc=0,(et&6)!==0)throw Error(ce(331));var r=et;for(et|=4,Me=n.current;Me!==null;){var s=Me,o=s.child;if((Me.flags&16)!==0){var a=s.deletions;if(a!==null){for(var l=0;l<a.length;l++){var u=a[l];for(Me=u;Me!==null;){var h=Me;switch(h.tag){case 0:case 11:case 15:Ho(8,h,s)}var c=h.child;if(c!==null)c.return=h,Me=c;else for(;Me!==null;){h=Me;var f=h.sibling,d=h.return;if(Bv(h),h===u){Me=null;break}if(f!==null){f.return=d,Me=f;break}Me=d}}}var m=s.alternate;if(m!==null){var x=m.child;if(x!==null){m.child=null;do{var y=x.sibling;x.sibling=null,x=y}while(x!==null)}}Me=s}}if((s.subtreeFlags&2064)!==0&&o!==null)o.return=s,Me=o;else e:for(;Me!==null;){if(s=Me,(s.flags&2048)!==0)switch(s.tag){case 0:case 11:case 15:Ho(9,s,s.return)}var p=s.sibling;if(p!==null){p.return=s.return,Me=p;break e}Me=s.return}}var _=n.current;for(Me=_;Me!==null;){o=Me;var g=o.child;if((o.subtreeFlags&2064)!==0&&g!==null)g.return=o,Me=g;else e:for(o=_;Me!==null;){if(a=Me,(a.flags&2048)!==0)try{switch(a.tag){case 0:case 11:case 15:_c(9,a)}}catch(M){Tt(a,a.return,M)}if(a===o){Me=null;break e}var v=a.sibling;if(v!==null){v.return=a.return,Me=v;break e}Me=a.return}}if(et=r,lr(),ci&&typeof ci.onPostCommitFiberRoot=="function")try{ci.onPostCommitFiberRoot(fc,n)}catch{}i=!0}return i}finally{rt=t,Nn.transition=e}}return!1}function e0(n,e,t){e=Ns(t,e),e=bv(n,e,1),n=er(n,e,1),e=tn(),n!==null&&(la(n,1,e),hn(n,e))}function Tt(n,e,t){if(n.tag===3)e0(n,n,t);else for(;e!==null;){if(e.tag===3){e0(e,n,t);break}else if(e.tag===1){var i=e.stateNode;if(typeof e.type.getDerivedStateFromError=="function"||typeof i.componentDidCatch=="function"&&(tr===null||!tr.has(i))){n=Ns(t,n),n=Cv(e,n,1),e=er(e,n,1),n=tn(),e!==null&&(la(e,1,n),hn(e,n));break}}e=e.return}}function bM(n,e,t){var i=n.pingCache;i!==null&&i.delete(e),e=tn(),n.pingedLanes|=n.suspendedLanes&t,Nt===n&&(Bt&t)===t&&(Pt===4||Pt===3&&(Bt&130023424)===Bt&&500>At()-Od?Ir(n,0):Fd|=t),hn(n,e)}function $v(n,e){e===0&&((n.mode&1)===0?e=1:(e=vl,vl<<=1,(vl&130023424)===0&&(vl=4194304)));var t=tn();n=Ei(n,e),n!==null&&(la(n,e,t),hn(n,t))}function CM(n){var e=n.memoizedState,t=0;e!==null&&(t=e.retryLane),$v(n,t)}function RM(n,e){var t=0;switch(n.tag){case 13:var i=n.stateNode,r=n.memoizedState;r!==null&&(t=r.retryLane);break;case 19:i=n.stateNode;break;default:throw Error(ce(314))}i!==null&&i.delete(e),$v(n,t)}var Zv;Zv=function(n,e,t){if(n!==null)if(n.memoizedProps!==e.pendingProps||cn.current)ln=!0;else{if((n.lanes&t)===0&&(e.flags&128)===0)return ln=!1,gM(n,e,t);ln=(n.flags&131072)!==0}else ln=!1,mt&&(e.flags&1048576)!==0&&j0(e,ec,e.index);switch(e.lanes=0,e.tag){case 2:var i=e.type;Bl(n,e),n=e.pendingProps;var r=Ps(e,Wt.current);bs(e,t),r=Pd(null,e,i,n,r,t);var s=Id();return e.flags|=1,typeof r=="object"&&r!==null&&typeof r.render=="function"&&r.$$typeof===void 0?(e.tag=1,e.memoizedState=null,e.updateQueue=null,un(i)?(s=!0,Ql(e)):s=!1,e.memoizedState=r.state!==null&&r.state!==void 0?r.state:null,Td(e),r.updater=yc,e.stateNode=r,r._reactInternals=e,Vf(e,i,n,t),e=Wf(null,e,i,!0,s,t)):(e.tag=0,mt&&s&&xd(e),en(null,e,r,t),e=e.child),e;case 16:i=e.elementType;e:{switch(Bl(n,e),n=e.pendingProps,r=i._init,i=r(i._payload),e.type=i,r=e.tag=IM(i),n=Gn(i,n),r){case 0:e=Gf(null,e,i,n,t);break e;case 1:e=Wg(null,e,i,n,t);break e;case 11:e=Hg(null,e,i,n,t);break e;case 14:e=Gg(null,e,i,Gn(i.type,n),t);break e}throw Error(ce(306,i,""))}return e;case 0:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Gn(i,r),Gf(n,e,i,r,t);case 1:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Gn(i,r),Wg(n,e,i,r,t);case 3:e:{if(Lv(e),n===null)throw Error(ce(387));i=e.pendingProps,s=e.memoizedState,r=s.element,sv(n,e),ic(e,i,null,t);var o=e.memoizedState;if(i=o.element,s.isDehydrated)if(s={element:i,isDehydrated:!1,cache:o.cache,pendingSuspenseBoundaries:o.pendingSuspenseBoundaries,transitions:o.transitions},e.updateQueue.baseState=s,e.memoizedState=s,e.flags&256){r=Ns(Error(ce(423)),e),e=Xg(n,e,i,t,r);break e}else if(i!==r){r=Ns(Error(ce(424)),e),e=Xg(n,e,i,t,r);break e}else for(xn=ji(e.stateNode.containerInfo.firstChild),yn=e,mt=!0,Xn=null,t=iv(e,null,i,t),e.child=t;t;)t.flags=t.flags&-3|4096,t=t.sibling;else{if(Is(),i===r){e=Ti(n,e,t);break e}en(n,e,i,t)}e=e.child}return e;case 5:return ov(e),n===null&&Bf(e),i=e.type,r=e.pendingProps,s=n!==null?n.memoizedProps:null,o=r.children,Df(i,r)?o=null:s!==null&&Df(i,s)&&(e.flags|=32),Iv(n,e),en(n,e,o,t),e.child;case 6:return n===null&&Bf(e),null;case 13:return Dv(n,e,t);case 4:return Ad(e,e.stateNode.containerInfo),i=e.pendingProps,n===null?e.child=Ls(e,null,i,t):en(n,e,i,t),e.child;case 11:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Gn(i,r),Hg(n,e,i,r,t);case 7:return en(n,e,e.pendingProps,t),e.child;case 8:return en(n,e,e.pendingProps.children,t),e.child;case 12:return en(n,e,e.pendingProps.children,t),e.child;case 10:e:{if(i=e.type._context,r=e.pendingProps,s=e.memoizedProps,o=r.value,ut(tc,i._currentValue),i._currentValue=o,s!==null)if($n(s.value,o)){if(s.children===r.children&&!cn.current){e=Ti(n,e,t);break e}}else for(s=e.child,s!==null&&(s.return=e);s!==null;){var a=s.dependencies;if(a!==null){o=s.child;for(var l=a.firstContext;l!==null;){if(l.context===i){if(s.tag===1){l=Si(-1,t&-t),l.tag=2;var u=s.updateQueue;if(u!==null){u=u.shared;var h=u.pending;h===null?l.next=l:(l.next=h.next,h.next=l),u.pending=l}}s.lanes|=t,l=s.alternate,l!==null&&(l.lanes|=t),kf(s.return,t,e),a.lanes|=t;break}l=l.next}}else if(s.tag===10)o=s.type===e.type?null:s.child;else if(s.tag===18){if(o=s.return,o===null)throw Error(ce(341));o.lanes|=t,a=o.alternate,a!==null&&(a.lanes|=t),kf(o,t,e),o=s.sibling}else o=s.child;if(o!==null)o.return=s;else for(o=s;o!==null;){if(o===e){o=null;break}if(s=o.sibling,s!==null){s.return=o.return,o=s;break}o=o.return}s=o}en(n,e,r.children,t),e=e.child}return e;case 9:return r=e.type,i=e.pendingProps.children,bs(e,t),r=Un(r),i=i(r),e.flags|=1,en(n,e,i,t),e.child;case 14:return i=e.type,r=Gn(i,e.pendingProps),r=Gn(i.type,r),Gg(n,e,i,r,t);case 15:return Rv(n,e,e.type,e.pendingProps,t);case 17:return i=e.type,r=e.pendingProps,r=e.elementType===i?r:Gn(i,r),Bl(n,e),e.tag=1,un(i)?(n=!0,Ql(e)):n=!1,bs(e,t),Av(e,i,r),Vf(e,i,r,t),Wf(null,e,i,!0,n,t);case 19:return Nv(n,e,t);case 22:return Pv(n,e,t)}throw Error(ce(156,e.tag))};function Jv(n,e){return w0(n,e)}function PM(n,e,t,i){this.tag=n,this.key=t,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.ref=null,this.pendingProps=e,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=i,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function Dn(n,e,t,i){return new PM(n,e,t,i)}function Vd(n){return n=n.prototype,!(!n||!n.isReactComponent)}function IM(n){if(typeof n=="function")return Vd(n)?1:0;if(n!=null){if(n=n.$$typeof,n===od)return 11;if(n===ad)return 14}return 2}function ir(n,e){var t=n.alternate;return t===null?(t=Dn(n.tag,e,n.key,n.mode),t.elementType=n.elementType,t.type=n.type,t.stateNode=n.stateNode,t.alternate=n,n.alternate=t):(t.pendingProps=e,t.type=n.type,t.flags=0,t.subtreeFlags=0,t.deletions=null),t.flags=n.flags&14680064,t.childLanes=n.childLanes,t.lanes=n.lanes,t.child=n.child,t.memoizedProps=n.memoizedProps,t.memoizedState=n.memoizedState,t.updateQueue=n.updateQueue,e=n.dependencies,t.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext},t.sibling=n.sibling,t.index=n.index,t.ref=n.ref,t}function Vl(n,e,t,i,r,s){var o=2;if(i=n,typeof n=="function")Vd(n)&&(o=1);else if(typeof n=="string")o=5;else e:switch(n){case fs:return Lr(t.children,r,s,e);case sd:o=8,r|=8;break;case hf:return n=Dn(12,t,e,r|2),n.elementType=hf,n.lanes=s,n;case ff:return n=Dn(13,t,e,r),n.elementType=ff,n.lanes=s,n;case df:return n=Dn(19,t,e,r),n.elementType=df,n.lanes=s,n;case o0:return Mc(t,r,s,e);default:if(typeof n=="object"&&n!==null)switch(n.$$typeof){case r0:o=10;break e;case s0:o=9;break e;case od:o=11;break e;case ad:o=14;break e;case Wi:o=16,i=null;break e}throw Error(ce(130,n==null?n:typeof n,""))}return e=Dn(o,t,e,r),e.elementType=n,e.type=i,e.lanes=s,e}function Lr(n,e,t,i){return n=Dn(7,n,i,e),n.lanes=t,n}function Mc(n,e,t,i){return n=Dn(22,n,i,e),n.elementType=o0,n.lanes=t,n.stateNode={isHidden:!1},n}function lf(n,e,t){return n=Dn(6,n,null,e),n.lanes=t,n}function cf(n,e,t){return e=Dn(4,n.children!==null?n.children:[],n.key,e),e.lanes=t,e.stateNode={containerInfo:n.containerInfo,pendingChildren:null,implementation:n.implementation},e}function LM(n,e,t,i,r){this.tag=e,this.containerInfo=n,this.finishedWork=this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.pendingContext=this.context=null,this.callbackPriority=0,this.eventTimes=Xh(0),this.expirationTimes=Xh(-1),this.entangledLanes=this.finishedLanes=this.mutableReadLanes=this.expiredLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=Xh(0),this.identifierPrefix=i,this.onRecoverableError=r,this.mutableSourceEagerHydrationData=null}function Hd(n,e,t,i,r,s,o,a,l){return n=new LM(n,e,t,a,l),e===1?(e=1,s===!0&&(e|=8)):e=0,s=Dn(3,null,null,e),n.current=s,s.stateNode=n,s.memoizedState={element:i,isDehydrated:t,cache:null,transitions:null,pendingSuspenseBoundaries:null},Td(s),n}function DM(n,e,t){var i=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:hs,key:i==null?null:""+i,children:n,containerInfo:e,implementation:t}}function Kv(n){if(!n)return sr;n=n._reactInternals;e:{if(kr(n)!==n||n.tag!==1)throw Error(ce(170));var e=n;do{switch(e.tag){case 3:e=e.stateNode.context;break e;case 1:if(un(e.type)){e=e.stateNode.__reactInternalMemoizedMergedChildContext;break e}}e=e.return}while(e!==null);throw Error(ce(171))}if(n.tag===1){var t=n.type;if(un(t))return K0(n,t,e)}return e}function Qv(n,e,t,i,r,s,o,a,l){return n=Hd(t,i,!0,n,r,s,o,a,l),n.context=Kv(null),t=n.current,i=tn(),r=nr(t),s=Si(i,r),s.callback=e??null,er(t,s,r),n.current.lanes=r,la(n,r,i),hn(n,i),n}function wc(n,e,t,i){var r=e.current,s=tn(),o=nr(r);return t=Kv(t),e.context===null?e.context=t:e.pendingContext=t,e=Si(s,o),e.payload={element:n},i=i===void 0?null:i,i!==null&&(e.callback=i),n=er(r,e,o),n!==null&&(qn(n,r,o,s),Ul(n,r,o)),o}function hc(n){if(n=n.current,!n.child)return null;switch(n.child.tag){case 5:return n.child.stateNode;default:return n.child.stateNode}}function t0(n,e){if(n=n.memoizedState,n!==null&&n.dehydrated!==null){var t=n.retryLane;n.retryLane=t!==0&&t<e?t:e}}function Gd(n,e){t0(n,e),(n=n.alternate)&&t0(n,e)}function NM(){return null}var jv=typeof reportError=="function"?reportError:function(n){console.error(n)};function Wd(n){this._internalRoot=n}Ec.prototype.render=Wd.prototype.render=function(n){var e=this._internalRoot;if(e===null)throw Error(ce(409));wc(n,e,null,null)};Ec.prototype.unmount=Wd.prototype.unmount=function(){var n=this._internalRoot;if(n!==null){this._internalRoot=null;var e=n.containerInfo;Or(function(){wc(null,n,null,null)}),e[wi]=null}};function Ec(n){this._internalRoot=n}Ec.prototype.unstable_scheduleHydration=function(n){if(n){var e=P0();n={blockedOn:null,target:n,priority:e};for(var t=0;t<Yi.length&&e!==0&&e<Yi[t].priority;t++);Yi.splice(t,0,n),t===0&&L0(n)}};function Xd(n){return!(!n||n.nodeType!==1&&n.nodeType!==9&&n.nodeType!==11)}function Tc(n){return!(!n||n.nodeType!==1&&n.nodeType!==9&&n.nodeType!==11&&(n.nodeType!==8||n.nodeValue!==" react-mount-point-unstable "))}function n0(){}function UM(n,e,t,i,r){if(r){if(typeof i=="function"){var s=i;i=function(){var u=hc(o);s.call(u)}}var o=Qv(e,i,n,0,null,!1,!1,"",n0);return n._reactRootContainer=o,n[wi]=o.current,jo(n.nodeType===8?n.parentNode:n),Or(),o}for(;r=n.lastChild;)n.removeChild(r);if(typeof i=="function"){var a=i;i=function(){var u=hc(l);a.call(u)}}var l=Hd(n,0,!1,null,null,!1,!1,"",n0);return n._reactRootContainer=l,n[wi]=l.current,jo(n.nodeType===8?n.parentNode:n),Or(function(){wc(e,l,t,i)}),l}function Ac(n,e,t,i,r){var s=t._reactRootContainer;if(s){var o=s;if(typeof r=="function"){var a=r;r=function(){var l=hc(o);a.call(l)}}wc(e,o,n,r)}else o=UM(t,e,n,r,i);return hc(o)}C0=function(n){switch(n.tag){case 3:var e=n.stateNode;if(e.current.memoizedState.isDehydrated){var t=No(e.pendingLanes);t!==0&&(ud(e,t|1),hn(e,At()),(et&6)===0&&(Us=At()+500,lr()))}break;case 13:Or(function(){var i=Ei(n,1);if(i!==null){var r=tn();qn(i,n,1,r)}}),Gd(n,1)}};hd=function(n){if(n.tag===13){var e=Ei(n,134217728);if(e!==null){var t=tn();qn(e,n,134217728,t)}Gd(n,134217728)}};R0=function(n){if(n.tag===13){var e=nr(n),t=Ei(n,e);if(t!==null){var i=tn();qn(t,n,e,i)}Gd(n,e)}};P0=function(){return rt};I0=function(n,e){var t=rt;try{return rt=n,e()}finally{rt=t}};wf=function(n,e,t){switch(e){case"input":if(gf(n,t),e=t.name,t.type==="radio"&&e!=null){for(t=n;t.parentNode;)t=t.parentNode;for(t=t.querySelectorAll("input[name="+JSON.stringify(""+e)+'][type="radio"]'),e=0;e<t.length;e++){var i=t[e];if(i!==n&&i.form===n.form){var r=gc(i);if(!r)throw Error(ce(90));l0(i),gf(i,r)}}}break;case"textarea":u0(n,t);break;case"select":e=t.value,e!=null&&ws(n,!!t.multiple,e,!1)}};v0=Bd;x0=Or;var FM={usingClientEntryPoint:!1,Events:[ua,gs,gc,m0,g0,Bd]},Po={findFiberByHostInstance:Cr,bundleType:0,version:"18.3.1",rendererPackageName:"react-dom"},OM={bundleType:Po.bundleType,version:Po.version,rendererPackageName:Po.rendererPackageName,rendererConfig:Po.rendererConfig,overrideHookState:null,overrideHookStateDeletePath:null,overrideHookStateRenamePath:null,overrideProps:null,overridePropsDeletePath:null,overridePropsRenamePath:null,setErrorHandler:null,setSuspenseHandler:null,scheduleUpdate:null,currentDispatcherRef:Ai.ReactCurrentDispatcher,findHostInstanceByFiber:function(n){return n=S0(n),n===null?null:n.stateNode},findFiberByHostInstance:Po.findFiberByHostInstance||NM,findHostInstancesForRefresh:null,scheduleRefresh:null,scheduleRoot:null,setRefreshHandler:null,getCurrentFiber:null,reconcilerVersion:"18.3.1-next-f1338f8080-20240426"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&(Io=__REACT_DEVTOOLS_GLOBAL_HOOK__,!Io.isDisabled&&Io.supportsFiber))try{fc=Io.inject(OM),ci=Io}catch{}var Io;Mn.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=FM;Mn.createPortal=function(n,e){var t=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!Xd(e))throw Error(ce(200));return DM(n,e,null,t)};Mn.createRoot=function(n,e){if(!Xd(n))throw Error(ce(299));var t=!1,i="",r=jv;return e!=null&&(e.unstable_strictMode===!0&&(t=!0),e.identifierPrefix!==void 0&&(i=e.identifierPrefix),e.onRecoverableError!==void 0&&(r=e.onRecoverableError)),e=Hd(n,1,!1,null,null,t,!1,i,r),n[wi]=e.current,jo(n.nodeType===8?n.parentNode:n),new Wd(e)};Mn.findDOMNode=function(n){if(n==null)return null;if(n.nodeType===1)return n;var e=n._reactInternals;if(e===void 0)throw typeof n.render=="function"?Error(ce(188)):(n=Object.keys(n).join(","),Error(ce(268,n)));return n=S0(e),n=n===null?null:n.stateNode,n};Mn.flushSync=function(n){return Or(n)};Mn.hydrate=function(n,e,t){if(!Tc(e))throw Error(ce(200));return Ac(null,n,e,!0,t)};Mn.hydrateRoot=function(n,e,t){if(!Xd(n))throw Error(ce(405));var i=t!=null&&t.hydratedSources||null,r=!1,s="",o=jv;if(t!=null&&(t.unstable_strictMode===!0&&(r=!0),t.identifierPrefix!==void 0&&(s=t.identifierPrefix),t.onRecoverableError!==void 0&&(o=t.onRecoverableError)),e=Qv(e,null,n,1,t??null,r,!1,s,o),n[wi]=e.current,jo(n),i)for(n=0;n<i.length;n++)t=i[n],r=t._getVersion,r=r(t._source),e.mutableSourceEagerHydrationData==null?e.mutableSourceEagerHydrationData=[t,r]:e.mutableSourceEagerHydrationData.push(t,r);return new Ec(e)};Mn.render=function(n,e,t){if(!Tc(e))throw Error(ce(200));return Ac(null,n,e,!1,t)};Mn.unmountComponentAtNode=function(n){if(!Tc(n))throw Error(ce(40));return n._reactRootContainer?(Or(function(){Ac(null,null,n,!1,function(){n._reactRootContainer=null,n[wi]=null})}),!0):!1};Mn.unstable_batchedUpdates=Bd;Mn.unstable_renderSubtreeIntoContainer=function(n,e,t,i){if(!Tc(t))throw Error(ce(200));if(n==null||n._reactInternals===void 0)throw Error(ce(38));return Ac(n,e,t,!1,i)};Mn.version="18.3.1-next-f1338f8080-20240426"});var ix=Vi((kb,nx)=>{"use strict";function tx(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(tx)}catch(n){console.error(n)}}tx(),nx.exports=ex()});var sx=Vi(Yd=>{"use strict";var rx=ix();Yd.createRoot=rx.createRoot,Yd.hydrateRoot=rx.hydrateRoot;var zb});var ox=Vi((fa,qd)=>{(function(e,t){typeof fa=="object"&&typeof qd=="object"?qd.exports=t():typeof define=="function"&&define.amd?define("Matter",[],t):typeof fa=="object"?fa.Matter=t():e.Matter=t()})(fa,function(){return(function(n){var e={};function t(i){if(e[i])return e[i].exports;var r=e[i]={i,l:!1,exports:{}};return n[i].call(r.exports,r,r.exports,t),r.l=!0,r.exports}return t.m=n,t.c=e,t.d=function(i,r,s){t.o(i,r)||Object.defineProperty(i,r,{enumerable:!0,get:s})},t.r=function(i){typeof Symbol<"u"&&Symbol.toStringTag&&Object.defineProperty(i,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(i,"__esModule",{value:!0})},t.t=function(i,r){if(r&1&&(i=t(i)),r&8||r&4&&typeof i=="object"&&i&&i.__esModule)return i;var s=Object.create(null);if(t.r(s),Object.defineProperty(s,"default",{enumerable:!0,value:i}),r&2&&typeof i!="string")for(var o in i)t.d(s,o,function(a){return i[a]}.bind(null,o));return s},t.n=function(i){var r=i&&i.__esModule?function(){return i.default}:function(){return i};return t.d(r,"a",r),r},t.o=function(i,r){return Object.prototype.hasOwnProperty.call(i,r)},t.p="",t(t.s=20)})([(function(n,e){var t={};n.exports=t,(function(){t._baseDelta=1e3/60,t._nextId=0,t._seed=0,t._nowStartTime=+new Date,t._warnedOnce={},t._decomp=null,t.extend=function(r,s){var o,a,l;typeof s=="boolean"?(o=2,l=s):(o=1,l=!0);for(var u=o;u<arguments.length;u++){var h=arguments[u];if(h)for(var c in h)l&&h[c]&&h[c].constructor===Object&&(!r[c]||r[c].constructor===Object)?(r[c]=r[c]||{},t.extend(r[c],l,h[c])):r[c]=h[c]}return r},t.clone=function(r,s){return t.extend({},s,r)},t.keys=function(r){if(Object.keys)return Object.keys(r);var s=[];for(var o in r)s.push(o);return s},t.values=function(r){var s=[];if(Object.keys){for(var o=Object.keys(r),a=0;a<o.length;a++)s.push(r[o[a]]);return s}for(var l in r)s.push(r[l]);return s},t.get=function(r,s,o,a){s=s.split(".").slice(o,a);for(var l=0;l<s.length;l+=1)r=r[s[l]];return r},t.set=function(r,s,o,a,l){var u=s.split(".").slice(a,l);return t.get(r,s,0,-1)[u[u.length-1]]=o,o},t.shuffle=function(r){for(var s=r.length-1;s>0;s--){var o=Math.floor(t.random()*(s+1)),a=r[s];r[s]=r[o],r[o]=a}return r},t.choose=function(r){return r[Math.floor(t.random()*r.length)]},t.isElement=function(r){return typeof HTMLElement<"u"?r instanceof HTMLElement:!!(r&&r.nodeType&&r.nodeName)},t.isArray=function(r){return Object.prototype.toString.call(r)==="[object Array]"},t.isFunction=function(r){return typeof r=="function"},t.isPlainObject=function(r){return typeof r=="object"&&r.constructor===Object},t.isString=function(r){return toString.call(r)==="[object String]"},t.clamp=function(r,s,o){return r<s?s:r>o?o:r},t.sign=function(r){return r<0?-1:1},t.now=function(){if(typeof window<"u"&&window.performance){if(window.performance.now)return window.performance.now();if(window.performance.webkitNow)return window.performance.webkitNow()}return Date.now?Date.now():new Date-t._nowStartTime},t.random=function(r,s){return r=typeof r<"u"?r:0,s=typeof s<"u"?s:1,r+i()*(s-r)};var i=function(){return t._seed=(t._seed*9301+49297)%233280,t._seed/233280};t.colorToNumber=function(r){return r=r.replace("#",""),r.length==3&&(r=r.charAt(0)+r.charAt(0)+r.charAt(1)+r.charAt(1)+r.charAt(2)+r.charAt(2)),parseInt(r,16)},t.logLevel=1,t.log=function(){console&&t.logLevel>0&&t.logLevel<=3&&console.log.apply(console,["matter-js:"].concat(Array.prototype.slice.call(arguments)))},t.info=function(){console&&t.logLevel>0&&t.logLevel<=2&&console.info.apply(console,["matter-js:"].concat(Array.prototype.slice.call(arguments)))},t.warn=function(){console&&t.logLevel>0&&t.logLevel<=3&&console.warn.apply(console,["matter-js:"].concat(Array.prototype.slice.call(arguments)))},t.warnOnce=function(){var r=Array.prototype.slice.call(arguments).join(" ");t._warnedOnce[r]||(t.warn(r),t._warnedOnce[r]=!0)},t.deprecated=function(r,s,o){r[s]=t.chain(function(){t.warnOnce("\u{1F505} deprecated \u{1F505}",o)},r[s])},t.nextId=function(){return t._nextId++},t.indexOf=function(r,s){if(r.indexOf)return r.indexOf(s);for(var o=0;o<r.length;o++)if(r[o]===s)return o;return-1},t.map=function(r,s){if(r.map)return r.map(s);for(var o=[],a=0;a<r.length;a+=1)o.push(s(r[a]));return o},t.topologicalSort=function(r){var s=[],o=[],a=[];for(var l in r)!o[l]&&!a[l]&&t._topologicalSort(l,o,a,r,s);return s},t._topologicalSort=function(r,s,o,a,l){var u=a[r]||[];o[r]=!0;for(var h=0;h<u.length;h+=1){var c=u[h];o[c]||s[c]||t._topologicalSort(c,s,o,a,l)}o[r]=!1,s[r]=!0,l.push(r)},t.chain=function(){for(var r=[],s=0;s<arguments.length;s+=1){var o=arguments[s];o._chained?r.push.apply(r,o._chained):r.push(o)}var a=function(){for(var l,u=new Array(arguments.length),h=0,c=arguments.length;h<c;h++)u[h]=arguments[h];for(h=0;h<r.length;h+=1){var f=r[h].apply(l,u);typeof f<"u"&&(l=f)}return l};return a._chained=r,a},t.chainPathBefore=function(r,s,o){return t.set(r,s,t.chain(o,t.get(r,s)))},t.chainPathAfter=function(r,s,o){return t.set(r,s,t.chain(t.get(r,s),o))},t.setDecomp=function(r){t._decomp=r},t.getDecomp=function(){var r=t._decomp;try{!r&&typeof window<"u"&&(r=window.decomp),!r&&typeof global<"u"&&(r=global.decomp)}catch{r=null}return r}})()}),(function(n,e){var t={};n.exports=t,(function(){t.create=function(i){var r={min:{x:0,y:0},max:{x:0,y:0}};return i&&t.update(r,i),r},t.update=function(i,r,s){i.min.x=1/0,i.max.x=-1/0,i.min.y=1/0,i.max.y=-1/0;for(var o=0;o<r.length;o++){var a=r[o];a.x>i.max.x&&(i.max.x=a.x),a.x<i.min.x&&(i.min.x=a.x),a.y>i.max.y&&(i.max.y=a.y),a.y<i.min.y&&(i.min.y=a.y)}s&&(s.x>0?i.max.x+=s.x:i.min.x+=s.x,s.y>0?i.max.y+=s.y:i.min.y+=s.y)},t.contains=function(i,r){return r.x>=i.min.x&&r.x<=i.max.x&&r.y>=i.min.y&&r.y<=i.max.y},t.overlaps=function(i,r){return i.min.x<=r.max.x&&i.max.x>=r.min.x&&i.max.y>=r.min.y&&i.min.y<=r.max.y},t.translate=function(i,r){i.min.x+=r.x,i.max.x+=r.x,i.min.y+=r.y,i.max.y+=r.y},t.shift=function(i,r){var s=i.max.x-i.min.x,o=i.max.y-i.min.y;i.min.x=r.x,i.max.x=r.x+s,i.min.y=r.y,i.max.y=r.y+o}})()}),(function(n,e){var t={};n.exports=t,(function(){t.create=function(i,r){return{x:i||0,y:r||0}},t.clone=function(i){return{x:i.x,y:i.y}},t.magnitude=function(i){return Math.sqrt(i.x*i.x+i.y*i.y)},t.magnitudeSquared=function(i){return i.x*i.x+i.y*i.y},t.rotate=function(i,r,s){var o=Math.cos(r),a=Math.sin(r);s||(s={});var l=i.x*o-i.y*a;return s.y=i.x*a+i.y*o,s.x=l,s},t.rotateAbout=function(i,r,s,o){var a=Math.cos(r),l=Math.sin(r);o||(o={});var u=s.x+((i.x-s.x)*a-(i.y-s.y)*l);return o.y=s.y+((i.x-s.x)*l+(i.y-s.y)*a),o.x=u,o},t.normalise=function(i){var r=t.magnitude(i);return r===0?{x:0,y:0}:{x:i.x/r,y:i.y/r}},t.dot=function(i,r){return i.x*r.x+i.y*r.y},t.cross=function(i,r){return i.x*r.y-i.y*r.x},t.cross3=function(i,r,s){return(r.x-i.x)*(s.y-i.y)-(r.y-i.y)*(s.x-i.x)},t.add=function(i,r,s){return s||(s={}),s.x=i.x+r.x,s.y=i.y+r.y,s},t.sub=function(i,r,s){return s||(s={}),s.x=i.x-r.x,s.y=i.y-r.y,s},t.mult=function(i,r){return{x:i.x*r,y:i.y*r}},t.div=function(i,r){return{x:i.x/r,y:i.y/r}},t.perp=function(i,r){return r=r===!0?-1:1,{x:r*-i.y,y:r*i.x}},t.neg=function(i){return{x:-i.x,y:-i.y}},t.angle=function(i,r){return Math.atan2(r.y-i.y,r.x-i.x)},t._temp=[t.create(),t.create(),t.create(),t.create(),t.create(),t.create()]})()}),(function(n,e,t){var i={};n.exports=i;var r=t(2),s=t(0);(function(){i.create=function(o,a){for(var l=[],u=0;u<o.length;u++){var h=o[u],c={x:h.x,y:h.y,index:u,body:a,isInternal:!1};l.push(c)}return l},i.fromPath=function(o,a){var l=/L?\s*([-\d.e]+)[\s,]*([-\d.e]+)*/ig,u=[];return o.replace(l,function(h,c,f){u.push({x:parseFloat(c),y:parseFloat(f)})}),i.create(u,a)},i.centre=function(o){for(var a=i.area(o,!0),l={x:0,y:0},u,h,c,f=0;f<o.length;f++)c=(f+1)%o.length,u=r.cross(o[f],o[c]),h=r.mult(r.add(o[f],o[c]),u),l=r.add(l,h);return r.div(l,6*a)},i.mean=function(o){for(var a={x:0,y:0},l=0;l<o.length;l++)a.x+=o[l].x,a.y+=o[l].y;return r.div(a,o.length)},i.area=function(o,a){for(var l=0,u=o.length-1,h=0;h<o.length;h++)l+=(o[u].x-o[h].x)*(o[u].y+o[h].y),u=h;return a?l/2:Math.abs(l)/2},i.inertia=function(o,a){for(var l=0,u=0,h=o,c,f,d=0;d<h.length;d++)f=(d+1)%h.length,c=Math.abs(r.cross(h[f],h[d])),l+=c*(r.dot(h[f],h[f])+r.dot(h[f],h[d])+r.dot(h[d],h[d])),u+=c;return a/6*(l/u)},i.translate=function(o,a,l){l=typeof l<"u"?l:1;var u=o.length,h=a.x*l,c=a.y*l,f;for(f=0;f<u;f++)o[f].x+=h,o[f].y+=c;return o},i.rotate=function(o,a,l){if(a!==0){var u=Math.cos(a),h=Math.sin(a),c=l.x,f=l.y,d=o.length,m,x,y,p;for(p=0;p<d;p++)m=o[p],x=m.x-c,y=m.y-f,m.x=c+(x*u-y*h),m.y=f+(x*h+y*u);return o}},i.contains=function(o,a){for(var l=a.x,u=a.y,h=o.length,c=o[h-1],f,d=0;d<h;d++){if(f=o[d],(l-c.x)*(f.y-c.y)+(u-c.y)*(c.x-f.x)>0)return!1;c=f}return!0},i.scale=function(o,a,l,u){if(a===1&&l===1)return o;u=u||i.centre(o);for(var h,c,f=0;f<o.length;f++)h=o[f],c=r.sub(h,u),o[f].x=u.x+c.x*a,o[f].y=u.y+c.y*l;return o},i.chamfer=function(o,a,l,u,h){typeof a=="number"?a=[a]:a=a||[8],l=typeof l<"u"?l:-1,u=u||2,h=h||14;for(var c=[],f=0;f<o.length;f++){var d=o[f-1>=0?f-1:o.length-1],m=o[f],x=o[(f+1)%o.length],y=a[f<a.length?f:a.length-1];if(y===0){c.push(m);continue}var p=r.normalise({x:m.y-d.y,y:d.x-m.x}),_=r.normalise({x:x.y-m.y,y:m.x-x.x}),g=Math.sqrt(2*Math.pow(y,2)),v=r.mult(s.clone(p),y),M=r.normalise(r.mult(r.add(p,_),.5)),S=r.sub(m,r.mult(M,g)),E=l;l===-1&&(E=Math.pow(y,.32)*1.75),E=s.clamp(E,u,h),E%2===1&&(E+=1);for(var A=Math.acos(r.dot(p,_)),w=A/E,T=0;T<E;T++)c.push(r.add(r.rotate(v,w*T),S))}return c},i.clockwiseSort=function(o){var a=i.mean(o);return o.sort(function(l,u){return r.angle(a,l)-r.angle(a,u)}),o},i.isConvex=function(o){var a=0,l=o.length,u,h,c,f;if(l<3)return null;for(u=0;u<l;u++)if(h=(u+1)%l,c=(u+2)%l,f=(o[h].x-o[u].x)*(o[c].y-o[h].y),f-=(o[h].y-o[u].y)*(o[c].x-o[h].x),f<0?a|=1:f>0&&(a|=2),a===3)return!1;return a!==0?!0:null},i.hull=function(o){var a=[],l=[],u,h;for(o=o.slice(0),o.sort(function(c,f){var d=c.x-f.x;return d!==0?d:c.y-f.y}),h=0;h<o.length;h+=1){for(u=o[h];l.length>=2&&r.cross3(l[l.length-2],l[l.length-1],u)<=0;)l.pop();l.push(u)}for(h=o.length-1;h>=0;h-=1){for(u=o[h];a.length>=2&&r.cross3(a[a.length-2],a[a.length-1],u)<=0;)a.pop();a.push(u)}return a.pop(),l.pop(),a.concat(l)}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(3),s=t(2),o=t(7),a=t(0),l=t(1),u=t(11);(function(){i._timeCorrection=!0,i._inertiaScale=4,i._nextCollidingGroupId=1,i._nextNonCollidingGroupId=-1,i._nextCategory=1,i._baseDelta=1e3/60,i.create=function(c){var f={id:a.nextId(),type:"body",label:"Body",parts:[],plugin:{},angle:0,vertices:r.fromPath("L 0 0 L 40 0 L 40 40 L 0 40"),position:{x:0,y:0},force:{x:0,y:0},torque:0,positionImpulse:{x:0,y:0},constraintImpulse:{x:0,y:0,angle:0},totalContacts:0,speed:0,angularSpeed:0,velocity:{x:0,y:0},angularVelocity:0,isSensor:!1,isStatic:!1,isSleeping:!1,motion:0,sleepThreshold:60,density:.001,restitution:0,friction:.1,frictionStatic:.5,frictionAir:.01,collisionFilter:{category:1,mask:4294967295,group:0},slop:.05,timeScale:1,render:{visible:!0,opacity:1,strokeStyle:null,fillStyle:null,lineWidth:null,sprite:{xScale:1,yScale:1,xOffset:0,yOffset:0}},events:null,bounds:null,chamfer:null,circleRadius:0,positionPrev:null,anglePrev:0,parent:null,axes:null,area:0,mass:0,inertia:0,deltaTime:16.666666666666668,_original:null},d=a.extend(f,c);return h(d,c),d},i.nextGroup=function(c){return c?i._nextNonCollidingGroupId--:i._nextCollidingGroupId++},i.nextCategory=function(){return i._nextCategory=i._nextCategory<<1,i._nextCategory};var h=function(c,f){f=f||{},i.set(c,{bounds:c.bounds||l.create(c.vertices),positionPrev:c.positionPrev||s.clone(c.position),anglePrev:c.anglePrev||c.angle,vertices:c.vertices,parts:c.parts||[c],isStatic:c.isStatic,isSleeping:c.isSleeping,parent:c.parent||c}),r.rotate(c.vertices,c.angle,c.position),u.rotate(c.axes,c.angle),l.update(c.bounds,c.vertices,c.velocity),i.set(c,{axes:f.axes||c.axes,area:f.area||c.area,mass:f.mass||c.mass,inertia:f.inertia||c.inertia});var d=c.isStatic?"#14151f":a.choose(["#f19648","#f5d259","#f55a3c","#063e7b","#ececd1"]),m=c.isStatic?"#555":"#ccc",x=c.isStatic&&c.render.fillStyle===null?1:0;c.render.fillStyle=c.render.fillStyle||d,c.render.strokeStyle=c.render.strokeStyle||m,c.render.lineWidth=c.render.lineWidth||x,c.render.sprite.xOffset+=-(c.bounds.min.x-c.position.x)/(c.bounds.max.x-c.bounds.min.x),c.render.sprite.yOffset+=-(c.bounds.min.y-c.position.y)/(c.bounds.max.y-c.bounds.min.y)};i.set=function(c,f,d){var m;typeof f=="string"&&(m=f,f={},f[m]=d);for(m in f)if(Object.prototype.hasOwnProperty.call(f,m))switch(d=f[m],m){case"isStatic":i.setStatic(c,d);break;case"isSleeping":o.set(c,d);break;case"mass":i.setMass(c,d);break;case"density":i.setDensity(c,d);break;case"inertia":i.setInertia(c,d);break;case"vertices":i.setVertices(c,d);break;case"position":i.setPosition(c,d);break;case"angle":i.setAngle(c,d);break;case"velocity":i.setVelocity(c,d);break;case"angularVelocity":i.setAngularVelocity(c,d);break;case"speed":i.setSpeed(c,d);break;case"angularSpeed":i.setAngularSpeed(c,d);break;case"parts":i.setParts(c,d);break;case"centre":i.setCentre(c,d);break;default:c[m]=d}},i.setStatic=function(c,f){for(var d=0;d<c.parts.length;d++){var m=c.parts[d];f?(m.isStatic||(m._original={restitution:m.restitution,friction:m.friction,mass:m.mass,inertia:m.inertia,density:m.density,inverseMass:m.inverseMass,inverseInertia:m.inverseInertia}),m.restitution=0,m.friction=1,m.mass=m.inertia=m.density=1/0,m.inverseMass=m.inverseInertia=0,m.positionPrev.x=m.position.x,m.positionPrev.y=m.position.y,m.anglePrev=m.angle,m.angularVelocity=0,m.speed=0,m.angularSpeed=0,m.motion=0):m._original&&(m.restitution=m._original.restitution,m.friction=m._original.friction,m.mass=m._original.mass,m.inertia=m._original.inertia,m.density=m._original.density,m.inverseMass=m._original.inverseMass,m.inverseInertia=m._original.inverseInertia,m._original=null),m.isStatic=f}},i.setMass=function(c,f){var d=c.inertia/(c.mass/6);c.inertia=d*(f/6),c.inverseInertia=1/c.inertia,c.mass=f,c.inverseMass=1/c.mass,c.density=c.mass/c.area},i.setDensity=function(c,f){i.setMass(c,f*c.area),c.density=f},i.setInertia=function(c,f){c.inertia=f,c.inverseInertia=1/c.inertia},i.setVertices=function(c,f){f[0].body===c?c.vertices=f:c.vertices=r.create(f,c),c.axes=u.fromVertices(c.vertices),c.area=r.area(c.vertices),i.setMass(c,c.density*c.area);var d=r.centre(c.vertices);r.translate(c.vertices,d,-1),i.setInertia(c,i._inertiaScale*r.inertia(c.vertices,c.mass)),r.translate(c.vertices,c.position),l.update(c.bounds,c.vertices,c.velocity)},i.setParts=function(c,f,d){var m;for(f=f.slice(0),c.parts.length=0,c.parts.push(c),c.parent=c,m=0;m<f.length;m++){var x=f[m];x!==c&&(x.parent=c,c.parts.push(x))}if(c.parts.length!==1){if(d=typeof d<"u"?d:!0,d){var y=[];for(m=0;m<f.length;m++)y=y.concat(f[m].vertices);r.clockwiseSort(y);var p=r.hull(y),_=r.centre(p);i.setVertices(c,p),r.translate(c.vertices,_)}var g=i._totalProperties(c);c.area=g.area,c.parent=c,c.position.x=g.centre.x,c.position.y=g.centre.y,c.positionPrev.x=g.centre.x,c.positionPrev.y=g.centre.y,i.setMass(c,g.mass),i.setInertia(c,g.inertia),i.setPosition(c,g.centre)}},i.setCentre=function(c,f,d){d?(c.positionPrev.x+=f.x,c.positionPrev.y+=f.y,c.position.x+=f.x,c.position.y+=f.y):(c.positionPrev.x=f.x-(c.position.x-c.positionPrev.x),c.positionPrev.y=f.y-(c.position.y-c.positionPrev.y),c.position.x=f.x,c.position.y=f.y)},i.setPosition=function(c,f,d){var m=s.sub(f,c.position);d?(c.positionPrev.x=c.position.x,c.positionPrev.y=c.position.y,c.velocity.x=m.x,c.velocity.y=m.y,c.speed=s.magnitude(m)):(c.positionPrev.x+=m.x,c.positionPrev.y+=m.y);for(var x=0;x<c.parts.length;x++){var y=c.parts[x];y.position.x+=m.x,y.position.y+=m.y,r.translate(y.vertices,m),l.update(y.bounds,y.vertices,c.velocity)}},i.setAngle=function(c,f,d){var m=f-c.angle;d?(c.anglePrev=c.angle,c.angularVelocity=m,c.angularSpeed=Math.abs(m)):c.anglePrev+=m;for(var x=0;x<c.parts.length;x++){var y=c.parts[x];y.angle+=m,r.rotate(y.vertices,m,c.position),u.rotate(y.axes,m),l.update(y.bounds,y.vertices,c.velocity),x>0&&s.rotateAbout(y.position,m,c.position,y.position)}},i.setVelocity=function(c,f){var d=c.deltaTime/i._baseDelta;c.positionPrev.x=c.position.x-f.x*d,c.positionPrev.y=c.position.y-f.y*d,c.velocity.x=(c.position.x-c.positionPrev.x)/d,c.velocity.y=(c.position.y-c.positionPrev.y)/d,c.speed=s.magnitude(c.velocity)},i.getVelocity=function(c){var f=i._baseDelta/c.deltaTime;return{x:(c.position.x-c.positionPrev.x)*f,y:(c.position.y-c.positionPrev.y)*f}},i.getSpeed=function(c){return s.magnitude(i.getVelocity(c))},i.setSpeed=function(c,f){i.setVelocity(c,s.mult(s.normalise(i.getVelocity(c)),f))},i.setAngularVelocity=function(c,f){var d=c.deltaTime/i._baseDelta;c.anglePrev=c.angle-f*d,c.angularVelocity=(c.angle-c.anglePrev)/d,c.angularSpeed=Math.abs(c.angularVelocity)},i.getAngularVelocity=function(c){return(c.angle-c.anglePrev)*i._baseDelta/c.deltaTime},i.getAngularSpeed=function(c){return Math.abs(i.getAngularVelocity(c))},i.setAngularSpeed=function(c,f){i.setAngularVelocity(c,a.sign(i.getAngularVelocity(c))*f)},i.translate=function(c,f,d){i.setPosition(c,s.add(c.position,f),d)},i.rotate=function(c,f,d,m){if(!d)i.setAngle(c,c.angle+f,m);else{var x=Math.cos(f),y=Math.sin(f),p=c.position.x-d.x,_=c.position.y-d.y;i.setPosition(c,{x:d.x+(p*x-_*y),y:d.y+(p*y+_*x)},m),i.setAngle(c,c.angle+f,m)}},i.scale=function(c,f,d,m){var x=0,y=0;m=m||c.position;for(var p=0;p<c.parts.length;p++){var _=c.parts[p];r.scale(_.vertices,f,d,m),_.axes=u.fromVertices(_.vertices),_.area=r.area(_.vertices),i.setMass(_,c.density*_.area),r.translate(_.vertices,{x:-_.position.x,y:-_.position.y}),i.setInertia(_,i._inertiaScale*r.inertia(_.vertices,_.mass)),r.translate(_.vertices,{x:_.position.x,y:_.position.y}),p>0&&(x+=_.area,y+=_.inertia),_.position.x=m.x+(_.position.x-m.x)*f,_.position.y=m.y+(_.position.y-m.y)*d,l.update(_.bounds,_.vertices,c.velocity)}c.parts.length>1&&(c.area=x,c.isStatic||(i.setMass(c,c.density*x),i.setInertia(c,y))),c.circleRadius&&(f===d?c.circleRadius*=f:c.circleRadius=null)},i.update=function(c,f){f=(typeof f<"u"?f:1e3/60)*c.timeScale;var d=f*f,m=i._timeCorrection?f/(c.deltaTime||f):1,x=1-c.frictionAir*(f/a._baseDelta),y=(c.position.x-c.positionPrev.x)*m,p=(c.position.y-c.positionPrev.y)*m;c.velocity.x=y*x+c.force.x/c.mass*d,c.velocity.y=p*x+c.force.y/c.mass*d,c.positionPrev.x=c.position.x,c.positionPrev.y=c.position.y,c.position.x+=c.velocity.x,c.position.y+=c.velocity.y,c.deltaTime=f,c.angularVelocity=(c.angle-c.anglePrev)*x*m+c.torque/c.inertia*d,c.anglePrev=c.angle,c.angle+=c.angularVelocity;for(var _=0;_<c.parts.length;_++){var g=c.parts[_];r.translate(g.vertices,c.velocity),_>0&&(g.position.x+=c.velocity.x,g.position.y+=c.velocity.y),c.angularVelocity!==0&&(r.rotate(g.vertices,c.angularVelocity,c.position),u.rotate(g.axes,c.angularVelocity),_>0&&s.rotateAbout(g.position,c.angularVelocity,c.position,g.position)),l.update(g.bounds,g.vertices,c.velocity)}},i.updateVelocities=function(c){var f=i._baseDelta/c.deltaTime,d=c.velocity;d.x=(c.position.x-c.positionPrev.x)*f,d.y=(c.position.y-c.positionPrev.y)*f,c.speed=Math.sqrt(d.x*d.x+d.y*d.y),c.angularVelocity=(c.angle-c.anglePrev)*f,c.angularSpeed=Math.abs(c.angularVelocity)},i.applyForce=function(c,f,d){var m={x:f.x-c.position.x,y:f.y-c.position.y};c.force.x+=d.x,c.force.y+=d.y,c.torque+=m.x*d.y-m.y*d.x},i._totalProperties=function(c){for(var f={mass:0,area:0,inertia:0,centre:{x:0,y:0}},d=c.parts.length===1?0:1;d<c.parts.length;d++){var m=c.parts[d],x=m.mass!==1/0?m.mass:1;f.mass+=x,f.area+=m.area,f.inertia+=m.inertia,f.centre=s.add(f.centre,s.mult(m.position,x))}return f.centre=s.div(f.centre,f.mass),f}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(0);(function(){i.on=function(s,o,a){for(var l=o.split(" "),u,h=0;h<l.length;h++)u=l[h],s.events=s.events||{},s.events[u]=s.events[u]||[],s.events[u].push(a);return a},i.off=function(s,o,a){if(!o){s.events={};return}typeof o=="function"&&(a=o,o=r.keys(s.events).join(" "));for(var l=o.split(" "),u=0;u<l.length;u++){var h=s.events[l[u]],c=[];if(a&&h)for(var f=0;f<h.length;f++)h[f]!==a&&c.push(h[f]);s.events[l[u]]=c}},i.trigger=function(s,o,a){var l,u,h,c,f=s.events;if(f&&r.keys(f).length>0){a||(a={}),l=o.split(" ");for(var d=0;d<l.length;d++)if(u=l[d],h=f[u],h){c=r.clone(a,!1),c.name=u,c.source=s;for(var m=0;m<h.length;m++)h[m].apply(s,[c])}}}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(5),s=t(0),o=t(1),a=t(4);(function(){i.create=function(l){return s.extend({id:s.nextId(),type:"composite",parent:null,isModified:!1,bodies:[],constraints:[],composites:[],label:"Composite",plugin:{},cache:{allBodies:null,allConstraints:null,allComposites:null}},l)},i.setModified=function(l,u,h,c){if(l.isModified=u,u&&l.cache&&(l.cache.allBodies=null,l.cache.allConstraints=null,l.cache.allComposites=null),h&&l.parent&&i.setModified(l.parent,u,h,c),c)for(var f=0;f<l.composites.length;f++){var d=l.composites[f];i.setModified(d,u,h,c)}},i.add=function(l,u){var h=[].concat(u);r.trigger(l,"beforeAdd",{object:u});for(var c=0;c<h.length;c++){var f=h[c];switch(f.type){case"body":if(f.parent!==f){s.warn("Composite.add: skipped adding a compound body part (you must add its parent instead)");break}i.addBody(l,f);break;case"constraint":i.addConstraint(l,f);break;case"composite":i.addComposite(l,f);break;case"mouseConstraint":i.addConstraint(l,f.constraint);break}}return r.trigger(l,"afterAdd",{object:u}),l},i.remove=function(l,u,h){var c=[].concat(u);r.trigger(l,"beforeRemove",{object:u});for(var f=0;f<c.length;f++){var d=c[f];switch(d.type){case"body":i.removeBody(l,d,h);break;case"constraint":i.removeConstraint(l,d,h);break;case"composite":i.removeComposite(l,d,h);break;case"mouseConstraint":i.removeConstraint(l,d.constraint);break}}return r.trigger(l,"afterRemove",{object:u}),l},i.addComposite=function(l,u){return l.composites.push(u),u.parent=l,i.setModified(l,!0,!0,!1),l},i.removeComposite=function(l,u,h){var c=s.indexOf(l.composites,u);if(c!==-1){var f=i.allBodies(u);i.removeCompositeAt(l,c);for(var d=0;d<f.length;d++)f[d].sleepCounter=0}if(h)for(var d=0;d<l.composites.length;d++)i.removeComposite(l.composites[d],u,!0);return l},i.removeCompositeAt=function(l,u){return l.composites.splice(u,1),i.setModified(l,!0,!0,!1),l},i.addBody=function(l,u){return l.bodies.push(u),i.setModified(l,!0,!0,!1),l},i.removeBody=function(l,u,h){var c=s.indexOf(l.bodies,u);if(c!==-1&&(i.removeBodyAt(l,c),u.sleepCounter=0),h)for(var f=0;f<l.composites.length;f++)i.removeBody(l.composites[f],u,!0);return l},i.removeBodyAt=function(l,u){return l.bodies.splice(u,1),i.setModified(l,!0,!0,!1),l},i.addConstraint=function(l,u){return l.constraints.push(u),i.setModified(l,!0,!0,!1),l},i.removeConstraint=function(l,u,h){var c=s.indexOf(l.constraints,u);if(c!==-1&&i.removeConstraintAt(l,c),h)for(var f=0;f<l.composites.length;f++)i.removeConstraint(l.composites[f],u,!0);return l},i.removeConstraintAt=function(l,u){return l.constraints.splice(u,1),i.setModified(l,!0,!0,!1),l},i.clear=function(l,u,h){if(h)for(var c=0;c<l.composites.length;c++)i.clear(l.composites[c],u,!0);return u?l.bodies=l.bodies.filter(function(f){return f.isStatic}):l.bodies.length=0,l.constraints.length=0,l.composites.length=0,i.setModified(l,!0,!0,!1),l},i.allBodies=function(l){if(l.cache&&l.cache.allBodies)return l.cache.allBodies;for(var u=[].concat(l.bodies),h=0;h<l.composites.length;h++)u=u.concat(i.allBodies(l.composites[h]));return l.cache&&(l.cache.allBodies=u),u},i.allConstraints=function(l){if(l.cache&&l.cache.allConstraints)return l.cache.allConstraints;for(var u=[].concat(l.constraints),h=0;h<l.composites.length;h++)u=u.concat(i.allConstraints(l.composites[h]));return l.cache&&(l.cache.allConstraints=u),u},i.allComposites=function(l){if(l.cache&&l.cache.allComposites)return l.cache.allComposites;for(var u=[].concat(l.composites),h=0;h<l.composites.length;h++)u=u.concat(i.allComposites(l.composites[h]));return l.cache&&(l.cache.allComposites=u),u},i.get=function(l,u,h){var c,f;switch(h){case"body":c=i.allBodies(l);break;case"constraint":c=i.allConstraints(l);break;case"composite":c=i.allComposites(l).concat(l);break}return c?(f=c.filter(function(d){return d.id.toString()===u.toString()}),f.length===0?null:f[0]):null},i.move=function(l,u,h){return i.remove(l,u),i.add(h,u),l},i.rebase=function(l){for(var u=i.allBodies(l).concat(i.allConstraints(l)).concat(i.allComposites(l)),h=0;h<u.length;h++)u[h].id=s.nextId();return l},i.translate=function(l,u,h){for(var c=h?i.allBodies(l):l.bodies,f=0;f<c.length;f++)a.translate(c[f],u);return l},i.rotate=function(l,u,h,c){for(var f=Math.cos(u),d=Math.sin(u),m=c?i.allBodies(l):l.bodies,x=0;x<m.length;x++){var y=m[x],p=y.position.x-h.x,_=y.position.y-h.y;a.setPosition(y,{x:h.x+(p*f-_*d),y:h.y+(p*d+_*f)}),a.rotate(y,u)}return l},i.scale=function(l,u,h,c,f){for(var d=f?i.allBodies(l):l.bodies,m=0;m<d.length;m++){var x=d[m],y=x.position.x-c.x,p=x.position.y-c.y;a.setPosition(x,{x:c.x+y*u,y:c.y+p*h}),a.scale(x,u,h)}return l},i.bounds=function(l){for(var u=i.allBodies(l),h=[],c=0;c<u.length;c+=1){var f=u[c];h.push(f.bounds.min,f.bounds.max)}return o.create(h)}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(4),s=t(5),o=t(0);(function(){i._motionWakeThreshold=.18,i._motionSleepThreshold=.08,i._minBias=.9,i.update=function(a,l){for(var u=l/o._baseDelta,h=i._motionSleepThreshold,c=0;c<a.length;c++){var f=a[c],d=r.getSpeed(f),m=r.getAngularSpeed(f),x=d*d+m*m;if(f.force.x!==0||f.force.y!==0){i.set(f,!1);continue}var y=Math.min(f.motion,x),p=Math.max(f.motion,x);f.motion=i._minBias*y+(1-i._minBias)*p,f.sleepThreshold>0&&f.motion<h?(f.sleepCounter+=1,f.sleepCounter>=f.sleepThreshold/u&&i.set(f,!0)):f.sleepCounter>0&&(f.sleepCounter-=1)}},i.afterCollisions=function(a){for(var l=i._motionSleepThreshold,u=0;u<a.length;u++){var h=a[u];if(h.isActive){var c=h.collision,f=c.bodyA.parent,d=c.bodyB.parent;if(!(f.isSleeping&&d.isSleeping||f.isStatic||d.isStatic)&&(f.isSleeping||d.isSleeping)){var m=f.isSleeping&&!f.isStatic?f:d,x=m===f?d:f;!m.isStatic&&x.motion>l&&i.set(m,!1)}}}},i.set=function(a,l){var u=a.isSleeping;l?(a.isSleeping=!0,a.sleepCounter=a.sleepThreshold,a.positionImpulse.x=0,a.positionImpulse.y=0,a.positionPrev.x=a.position.x,a.positionPrev.y=a.position.y,a.anglePrev=a.angle,a.speed=0,a.angularSpeed=0,a.motion=0,u||s.trigger(a,"sleepStart")):(a.isSleeping=!1,a.sleepCounter=0,u&&s.trigger(a,"sleepEnd"))}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(3),s=t(9);(function(){var o=[],a={overlap:0,axis:null},l={overlap:0,axis:null};i.create=function(u,h){return{pair:null,collided:!1,bodyA:u,bodyB:h,parentA:u.parent,parentB:h.parent,depth:0,normal:{x:0,y:0},tangent:{x:0,y:0},penetration:{x:0,y:0},supports:[null,null],supportCount:0}},i.collides=function(u,h,c){if(i._overlapAxes(a,u.vertices,h.vertices,u.axes),a.overlap<=0||(i._overlapAxes(l,h.vertices,u.vertices,h.axes),l.overlap<=0))return null;var f=c&&c.table[s.id(u,h)],d;f?d=f.collision:(d=i.create(u,h),d.collided=!0,d.bodyA=u.id<h.id?u:h,d.bodyB=u.id<h.id?h:u,d.parentA=d.bodyA.parent,d.parentB=d.bodyB.parent),u=d.bodyA,h=d.bodyB;var m;a.overlap<l.overlap?m=a:m=l;var x=d.normal,y=d.tangent,p=d.penetration,_=d.supports,g=m.overlap,v=m.axis,M=v.x,S=v.y,E=h.position.x-u.position.x,A=h.position.y-u.position.y;M*E+S*A>=0&&(M=-M,S=-S),x.x=M,x.y=S,y.x=-S,y.y=M,p.x=M*g,p.y=S*g,d.depth=g;var w=i._findSupports(u,h,x,1),T=0;if(r.contains(u.vertices,w[0])&&(_[T++]=w[0]),r.contains(u.vertices,w[1])&&(_[T++]=w[1]),T<2){var b=i._findSupports(h,u,x,-1);r.contains(h.vertices,b[0])&&(_[T++]=b[0]),T<2&&r.contains(h.vertices,b[1])&&(_[T++]=b[1])}return T===0&&(_[T++]=w[0]),d.supportCount=T,d},i._overlapAxes=function(u,h,c,f){var d=h.length,m=c.length,x=h[0].x,y=h[0].y,p=c[0].x,_=c[0].y,g=f.length,v=Number.MAX_VALUE,M=0,S,E,A,w,T,b;for(T=0;T<g;T++){var L=f[T],D=L.x,F=L.y,U=x*D+y*F,O=p*D+_*F,Z=U,W=O;for(b=1;b<d;b+=1)w=h[b].x*D+h[b].y*F,w>Z?Z=w:w<U&&(U=w);for(b=1;b<m;b+=1)w=c[b].x*D+c[b].y*F,w>W?W=w:w<O&&(O=w);if(E=Z-O,A=W-U,S=E<A?E:A,S<v&&(v=S,M=T,S<=0))break}u.axis=f[M],u.overlap=v},i._findSupports=function(u,h,c,f){var d=h.vertices,m=d.length,x=u.position.x,y=u.position.y,p=c.x*f,_=c.y*f,g=d[0],v=g,M=p*(x-v.x)+_*(y-v.y),S,E,A;for(A=1;A<m;A+=1)v=d[A],E=p*(x-v.x)+_*(y-v.y),E<M&&(M=E,g=v);return S=d[(m+g.index-1)%m],M=p*(x-S.x)+_*(y-S.y),v=d[(g.index+1)%m],p*(x-v.x)+_*(y-v.y)<M?(o[0]=g,o[1]=v,o):(o[0]=g,o[1]=S,o)}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(16);(function(){i.create=function(s,o){var a=s.bodyA,l=s.bodyB,u={id:i.id(a,l),bodyA:a,bodyB:l,collision:s,contacts:[r.create(),r.create()],contactCount:0,separation:0,isActive:!0,isSensor:a.isSensor||l.isSensor,timeCreated:o,timeUpdated:o,inverseMass:0,friction:0,frictionStatic:0,restitution:0,slop:0};return i.update(u,s,o),u},i.update=function(s,o,a){var l=o.supports,u=o.supportCount,h=s.contacts,c=o.parentA,f=o.parentB;s.isActive=!0,s.timeUpdated=a,s.collision=o,s.separation=o.depth,s.inverseMass=c.inverseMass+f.inverseMass,s.friction=c.friction<f.friction?c.friction:f.friction,s.frictionStatic=c.frictionStatic>f.frictionStatic?c.frictionStatic:f.frictionStatic,s.restitution=c.restitution>f.restitution?c.restitution:f.restitution,s.slop=c.slop>f.slop?c.slop:f.slop,s.contactCount=u,o.pair=s;var d=l[0],m=h[0],x=l[1],y=h[1];(y.vertex===d||m.vertex===x)&&(h[1]=m,h[0]=m=y,y=h[1]),m.vertex=d,y.vertex=x},i.setActive=function(s,o,a){o?(s.isActive=!0,s.timeUpdated=a):(s.isActive=!1,s.contactCount=0)},i.id=function(s,o){return s.id<o.id?s.id.toString(36)+":"+o.id.toString(36):o.id.toString(36)+":"+s.id.toString(36)}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(3),s=t(2),o=t(7),a=t(1),l=t(11),u=t(0);(function(){i._warming=.4,i._torqueDampen=1,i._minLength=1e-6,i.create=function(h){var c=h;c.bodyA&&!c.pointA&&(c.pointA={x:0,y:0}),c.bodyB&&!c.pointB&&(c.pointB={x:0,y:0});var f=c.bodyA?s.add(c.bodyA.position,c.pointA):c.pointA,d=c.bodyB?s.add(c.bodyB.position,c.pointB):c.pointB,m=s.magnitude(s.sub(f,d));c.length=typeof c.length<"u"?c.length:m,c.id=c.id||u.nextId(),c.label=c.label||"Constraint",c.type="constraint",c.stiffness=c.stiffness||(c.length>0?1:.7),c.damping=c.damping||0,c.angularStiffness=c.angularStiffness||0,c.angleA=c.bodyA?c.bodyA.angle:c.angleA,c.angleB=c.bodyB?c.bodyB.angle:c.angleB,c.plugin={};var x={visible:!0,lineWidth:2,strokeStyle:"#ffffff",type:"line",anchors:!0};return c.length===0&&c.stiffness>.1?(x.type="pin",x.anchors=!1):c.stiffness<.9&&(x.type="spring"),c.render=u.extend(x,c.render),c},i.preSolveAll=function(h){for(var c=0;c<h.length;c+=1){var f=h[c],d=f.constraintImpulse;f.isStatic||d.x===0&&d.y===0&&d.angle===0||(f.position.x+=d.x,f.position.y+=d.y,f.angle+=d.angle)}},i.solveAll=function(h,c){for(var f=u.clamp(c/u._baseDelta,0,1),d=0;d<h.length;d+=1){var m=h[d],x=!m.bodyA||m.bodyA&&m.bodyA.isStatic,y=!m.bodyB||m.bodyB&&m.bodyB.isStatic;(x||y)&&i.solve(h[d],f)}for(d=0;d<h.length;d+=1)m=h[d],x=!m.bodyA||m.bodyA&&m.bodyA.isStatic,y=!m.bodyB||m.bodyB&&m.bodyB.isStatic,!x&&!y&&i.solve(h[d],f)},i.solve=function(h,c){var f=h.bodyA,d=h.bodyB,m=h.pointA,x=h.pointB;if(!(!f&&!d)){f&&!f.isStatic&&(s.rotate(m,f.angle-h.angleA,m),h.angleA=f.angle),d&&!d.isStatic&&(s.rotate(x,d.angle-h.angleB,x),h.angleB=d.angle);var y=m,p=x;if(f&&(y=s.add(f.position,m)),d&&(p=s.add(d.position,x)),!(!y||!p)){var _=s.sub(y,p),g=s.magnitude(_);g<i._minLength&&(g=i._minLength);var v=(g-h.length)/g,M=h.stiffness>=1||h.length===0,S=M?h.stiffness*c:h.stiffness*c*c,E=h.damping*c,A=s.mult(_,v*S),w=(f?f.inverseMass:0)+(d?d.inverseMass:0),T=(f?f.inverseInertia:0)+(d?d.inverseInertia:0),b=w+T,L,D,F,U,O;if(E>0){var Z=s.create();F=s.div(_,g),O=s.sub(d&&s.sub(d.position,d.positionPrev)||Z,f&&s.sub(f.position,f.positionPrev)||Z),U=s.dot(F,O)}f&&!f.isStatic&&(D=f.inverseMass/w,f.constraintImpulse.x-=A.x*D,f.constraintImpulse.y-=A.y*D,f.position.x-=A.x*D,f.position.y-=A.y*D,E>0&&(f.positionPrev.x-=E*F.x*U*D,f.positionPrev.y-=E*F.y*U*D),L=s.cross(m,A)/b*i._torqueDampen*f.inverseInertia*(1-h.angularStiffness),f.constraintImpulse.angle-=L,f.angle-=L),d&&!d.isStatic&&(D=d.inverseMass/w,d.constraintImpulse.x+=A.x*D,d.constraintImpulse.y+=A.y*D,d.position.x+=A.x*D,d.position.y+=A.y*D,E>0&&(d.positionPrev.x+=E*F.x*U*D,d.positionPrev.y+=E*F.y*U*D),L=s.cross(x,A)/b*i._torqueDampen*d.inverseInertia*(1-h.angularStiffness),d.constraintImpulse.angle+=L,d.angle+=L)}}},i.postSolveAll=function(h){for(var c=0;c<h.length;c++){var f=h[c],d=f.constraintImpulse;if(!(f.isStatic||d.x===0&&d.y===0&&d.angle===0)){o.set(f,!1);for(var m=0;m<f.parts.length;m++){var x=f.parts[m];r.translate(x.vertices,d),m>0&&(x.position.x+=d.x,x.position.y+=d.y),d.angle!==0&&(r.rotate(x.vertices,d.angle,f.position),l.rotate(x.axes,d.angle),m>0&&s.rotateAbout(x.position,d.angle,f.position,x.position)),a.update(x.bounds,x.vertices,f.velocity)}d.angle*=i._warming,d.x*=i._warming,d.y*=i._warming}}},i.pointAWorld=function(h){return{x:(h.bodyA?h.bodyA.position.x:0)+(h.pointA?h.pointA.x:0),y:(h.bodyA?h.bodyA.position.y:0)+(h.pointA?h.pointA.y:0)}},i.pointBWorld=function(h){return{x:(h.bodyB?h.bodyB.position.x:0)+(h.pointB?h.pointB.x:0),y:(h.bodyB?h.bodyB.position.y:0)+(h.pointB?h.pointB.y:0)}},i.currentLength=function(h){var c=(h.bodyA?h.bodyA.position.x:0)+(h.pointA?h.pointA.x:0),f=(h.bodyA?h.bodyA.position.y:0)+(h.pointA?h.pointA.y:0),d=(h.bodyB?h.bodyB.position.x:0)+(h.pointB?h.pointB.x:0),m=(h.bodyB?h.bodyB.position.y:0)+(h.pointB?h.pointB.y:0),x=c-d,y=f-m;return Math.sqrt(x*x+y*y)}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(2),s=t(0);(function(){i.fromVertices=function(o){for(var a={},l=0;l<o.length;l++){var u=(l+1)%o.length,h=r.normalise({x:o[u].y-o[l].y,y:o[l].x-o[u].x}),c=h.y===0?1/0:h.x/h.y;c=c.toFixed(3).toString(),a[c]=h}return s.values(a)},i.rotate=function(o,a){if(a!==0)for(var l=Math.cos(a),u=Math.sin(a),h=0;h<o.length;h++){var c=o[h],f;f=c.x*l-c.y*u,c.y=c.x*u+c.y*l,c.x=f}}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(3),s=t(0),o=t(4),a=t(1),l=t(2);(function(){i.rectangle=function(u,h,c,f,d){d=d||{};var m={label:"Rectangle Body",position:{x:u,y:h},vertices:r.fromPath("L 0 0 L "+c+" 0 L "+c+" "+f+" L 0 "+f)};if(d.chamfer){var x=d.chamfer;m.vertices=r.chamfer(m.vertices,x.radius,x.quality,x.qualityMin,x.qualityMax),delete d.chamfer}return o.create(s.extend({},m,d))},i.trapezoid=function(u,h,c,f,d,m){m=m||{},d>=1&&s.warn("Bodies.trapezoid: slope parameter must be < 1."),d*=.5;var x=(1-d*2)*c,y=c*d,p=y+x,_=p+y,g;d<.5?g="L 0 0 L "+y+" "+-f+" L "+p+" "+-f+" L "+_+" 0":g="L 0 0 L "+p+" "+-f+" L "+_+" 0";var v={label:"Trapezoid Body",position:{x:u,y:h},vertices:r.fromPath(g)};if(m.chamfer){var M=m.chamfer;v.vertices=r.chamfer(v.vertices,M.radius,M.quality,M.qualityMin,M.qualityMax),delete m.chamfer}return o.create(s.extend({},v,m))},i.circle=function(u,h,c,f,d){f=f||{};var m={label:"Circle Body",circleRadius:c};d=d||25;var x=Math.ceil(Math.max(10,Math.min(d,c)));return x%2===1&&(x+=1),i.polygon(u,h,x,c,s.extend({},m,f))},i.polygon=function(u,h,c,f,d){if(d=d||{},c<3)return i.circle(u,h,f,d);for(var m=2*Math.PI/c,x="",y=m*.5,p=0;p<c;p+=1){var _=y+p*m,g=Math.cos(_)*f,v=Math.sin(_)*f;x+="L "+g.toFixed(3)+" "+v.toFixed(3)+" "}var M={label:"Polygon Body",position:{x:u,y:h},vertices:r.fromPath(x)};if(d.chamfer){var S=d.chamfer;M.vertices=r.chamfer(M.vertices,S.radius,S.quality,S.qualityMin,S.qualityMax),delete d.chamfer}return o.create(s.extend({},M,d))},i.fromVertices=function(u,h,c,f,d,m,x,y){var p=s.getDecomp(),_,g,v,M,S,E,A,w,T,b,L;for(_=!!(p&&p.quickDecomp),f=f||{},v=[],d=typeof d<"u"?d:!1,m=typeof m<"u"?m:.01,x=typeof x<"u"?x:10,y=typeof y<"u"?y:.01,s.isArray(c[0])||(c=[c]),b=0;b<c.length;b+=1)if(E=c[b],M=r.isConvex(E),S=!M,S&&!_&&s.warnOnce("Bodies.fromVertices: Install the 'poly-decomp' library and use Common.setDecomp or provide 'decomp' as a global to decompose concave vertices."),M||!_)M?E=r.clockwiseSort(E):E=r.hull(E),v.push({position:{x:u,y:h},vertices:E});else{var D=E.map(function(Ee){return[Ee.x,Ee.y]});p.makeCCW(D),m!==!1&&p.removeCollinearPoints(D,m),y!==!1&&p.removeDuplicatePoints&&p.removeDuplicatePoints(D,y);var F=p.quickDecomp(D);for(A=0;A<F.length;A++){var U=F[A],O=U.map(function(Ee){return{x:Ee[0],y:Ee[1]}});x>0&&r.area(O)<x||v.push({position:r.centre(O),vertices:O})}}for(A=0;A<v.length;A++)v[A]=o.create(s.extend(v[A],f));if(d){var Z=5;for(A=0;A<v.length;A++){var W=v[A];for(w=A+1;w<v.length;w++){var ne=v[w];if(a.overlaps(W.bounds,ne.bounds)){var re=W.vertices,de=ne.vertices;for(T=0;T<W.vertices.length;T++)for(L=0;L<ne.vertices.length;L++){var Ue=l.magnitudeSquared(l.sub(re[(T+1)%re.length],de[L])),He=l.magnitudeSquared(l.sub(re[T],de[(L+1)%de.length]));Ue<Z&&He<Z&&(re[T].isInternal=!0,de[L].isInternal=!0)}}}}}return v.length>1?(g=o.create(s.extend({parts:v.slice(0)},f)),o.setPosition(g,{x:u,y:h}),g):v[0]}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(0),s=t(8);(function(){i.create=function(o){var a={bodies:[],collisions:[],pairs:null};return r.extend(a,o)},i.setBodies=function(o,a){o.bodies=a.slice(0)},i.clear=function(o){o.bodies=[],o.collisions=[]},i.collisions=function(o){var a=o.pairs,l=o.bodies,u=l.length,h=i.canCollide,c=s.collides,f=o.collisions,d=0,m,x;for(l.sort(i._compareBoundsX),m=0;m<u;m++){var y=l[m],p=y.bounds,_=y.bounds.max.x,g=y.bounds.max.y,v=y.bounds.min.y,M=y.isStatic||y.isSleeping,S=y.parts.length,E=S===1;for(x=m+1;x<u;x++){var A=l[x],w=A.bounds;if(w.min.x>_)break;if(!(g<w.min.y||v>w.max.y)&&!(M&&(A.isStatic||A.isSleeping))&&h(y.collisionFilter,A.collisionFilter)){var T=A.parts.length;if(E&&T===1){var b=c(y,A,a);b&&(f[d++]=b)}else for(var L=S>1?1:0,D=T>1?1:0,F=L;F<S;F++)for(var U=y.parts[F],p=U.bounds,O=D;O<T;O++){var Z=A.parts[O],w=Z.bounds;if(!(p.min.x>w.max.x||p.max.x<w.min.x||p.max.y<w.min.y||p.min.y>w.max.y)){var b=c(U,Z,a);b&&(f[d++]=b)}}}}}return f.length!==d&&(f.length=d),f},i.canCollide=function(o,a){return o.group===a.group&&o.group!==0?o.group>0:(o.mask&a.category)!==0&&(a.mask&o.category)!==0},i._compareBoundsX=function(o,a){return o.bounds.min.x-a.bounds.min.x}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(0);(function(){i.create=function(s){var o={};return s||r.log("Mouse.create: element was undefined, defaulting to document.body","warn"),o.element=s||document.body,o.absolute={x:0,y:0},o.position={x:0,y:0},o.mousedownPosition={x:0,y:0},o.mouseupPosition={x:0,y:0},o.offset={x:0,y:0},o.scale={x:1,y:1},o.wheelDelta=0,o.button=-1,o.pixelRatio=parseInt(o.element.getAttribute("data-pixel-ratio"),10)||1,o.sourceEvents={mousemove:null,mousedown:null,mouseup:null,mousewheel:null},o.mousemove=function(a){var l=i._getRelativeMousePosition(a,o.element,o.pixelRatio),u=a.changedTouches;u&&(o.button=0,a.preventDefault()),o.absolute.x=l.x,o.absolute.y=l.y,o.position.x=o.absolute.x*o.scale.x+o.offset.x,o.position.y=o.absolute.y*o.scale.y+o.offset.y,o.sourceEvents.mousemove=a},o.mousedown=function(a){var l=i._getRelativeMousePosition(a,o.element,o.pixelRatio),u=a.changedTouches;u?(o.button=0,a.preventDefault()):o.button=a.button,o.absolute.x=l.x,o.absolute.y=l.y,o.position.x=o.absolute.x*o.scale.x+o.offset.x,o.position.y=o.absolute.y*o.scale.y+o.offset.y,o.mousedownPosition.x=o.position.x,o.mousedownPosition.y=o.position.y,o.sourceEvents.mousedown=a},o.mouseup=function(a){var l=i._getRelativeMousePosition(a,o.element,o.pixelRatio),u=a.changedTouches;u&&a.preventDefault(),o.button=-1,o.absolute.x=l.x,o.absolute.y=l.y,o.position.x=o.absolute.x*o.scale.x+o.offset.x,o.position.y=o.absolute.y*o.scale.y+o.offset.y,o.mouseupPosition.x=o.position.x,o.mouseupPosition.y=o.position.y,o.sourceEvents.mouseup=a},o.mousewheel=function(a){o.wheelDelta=Math.max(-1,Math.min(1,a.wheelDelta||-a.detail)),a.preventDefault(),o.sourceEvents.mousewheel=a},i.setElement(o,o.element),o},i.setElement=function(s,o){s.element=o,o.addEventListener("mousemove",s.mousemove,{passive:!0}),o.addEventListener("mousedown",s.mousedown,{passive:!0}),o.addEventListener("mouseup",s.mouseup,{passive:!0}),o.addEventListener("wheel",s.mousewheel,{passive:!1}),o.addEventListener("touchmove",s.mousemove,{passive:!1}),o.addEventListener("touchstart",s.mousedown,{passive:!1}),o.addEventListener("touchend",s.mouseup,{passive:!1})},i.clearSourceEvents=function(s){s.sourceEvents.mousemove=null,s.sourceEvents.mousedown=null,s.sourceEvents.mouseup=null,s.sourceEvents.mousewheel=null,s.wheelDelta=0},i.setOffset=function(s,o){s.offset.x=o.x,s.offset.y=o.y,s.position.x=s.absolute.x*s.scale.x+s.offset.x,s.position.y=s.absolute.y*s.scale.y+s.offset.y},i.setScale=function(s,o){s.scale.x=o.x,s.scale.y=o.y,s.position.x=s.absolute.x*s.scale.x+s.offset.x,s.position.y=s.absolute.y*s.scale.y+s.offset.y},i._getRelativeMousePosition=function(s,o,a){var l=o.getBoundingClientRect(),u=document.documentElement||document.body.parentNode||document.body,h=window.pageXOffset!==void 0?window.pageXOffset:u.scrollLeft,c=window.pageYOffset!==void 0?window.pageYOffset:u.scrollTop,f=s.changedTouches,d,m;return f?(d=f[0].pageX-l.left-h,m=f[0].pageY-l.top-c):(d=s.pageX-l.left-h,m=s.pageY-l.top-c),{x:d/(o.clientWidth/(o.width||o.clientWidth)*a),y:m/(o.clientHeight/(o.height||o.clientHeight)*a)}}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(0);(function(){i._registry={},i.register=function(s){if(i.isPlugin(s)||r.warn("Plugin.register:",i.toString(s),"does not implement all required fields."),s.name in i._registry){var o=i._registry[s.name],a=i.versionParse(s.version).number,l=i.versionParse(o.version).number;a>l?(r.warn("Plugin.register:",i.toString(o),"was upgraded to",i.toString(s)),i._registry[s.name]=s):a<l?r.warn("Plugin.register:",i.toString(o),"can not be downgraded to",i.toString(s)):s!==o&&r.warn("Plugin.register:",i.toString(s),"is already registered to different plugin object")}else i._registry[s.name]=s;return s},i.resolve=function(s){return i._registry[i.dependencyParse(s).name]},i.toString=function(s){return typeof s=="string"?s:(s.name||"anonymous")+"@"+(s.version||s.range||"0.0.0")},i.isPlugin=function(s){return s&&s.name&&s.version&&s.install},i.isUsed=function(s,o){return s.used.indexOf(o)>-1},i.isFor=function(s,o){var a=s.for&&i.dependencyParse(s.for);return!s.for||o.name===a.name&&i.versionSatisfies(o.version,a.range)},i.use=function(s,o){if(s.uses=(s.uses||[]).concat(o||[]),s.uses.length===0){r.warn("Plugin.use:",i.toString(s),"does not specify any dependencies to install.");return}for(var a=i.dependencies(s),l=r.topologicalSort(a),u=[],h=0;h<l.length;h+=1)if(l[h]!==s.name){var c=i.resolve(l[h]);if(!c){u.push("\u274C "+l[h]);continue}i.isUsed(s,c.name)||(i.isFor(c,s)||(r.warn("Plugin.use:",i.toString(c),"is for",c.for,"but installed on",i.toString(s)+"."),c._warned=!0),c.install?c.install(s):(r.warn("Plugin.use:",i.toString(c),"does not specify an install function."),c._warned=!0),c._warned?(u.push("\u{1F536} "+i.toString(c)),delete c._warned):u.push("\u2705 "+i.toString(c)),s.used.push(c.name))}u.length>0&&r.info(u.join("  "))},i.dependencies=function(s,o){var a=i.dependencyParse(s),l=a.name;if(o=o||{},!(l in o)){s=i.resolve(s)||s,o[l]=r.map(s.uses||[],function(h){i.isPlugin(h)&&i.register(h);var c=i.dependencyParse(h),f=i.resolve(h);return f&&!i.versionSatisfies(f.version,c.range)?(r.warn("Plugin.dependencies:",i.toString(f),"does not satisfy",i.toString(c),"used by",i.toString(a)+"."),f._warned=!0,s._warned=!0):f||(r.warn("Plugin.dependencies:",i.toString(h),"used by",i.toString(a),"could not be resolved."),s._warned=!0),c.name});for(var u=0;u<o[l].length;u+=1)i.dependencies(o[l][u],o);return o}},i.dependencyParse=function(s){if(r.isString(s)){var o=/^[\w-]+(@(\*|[\^~]?\d+\.\d+\.\d+(-[0-9A-Za-z-+]+)?))?$/;return o.test(s)||r.warn("Plugin.dependencyParse:",s,"is not a valid dependency string."),{name:s.split("@")[0],range:s.split("@")[1]||"*"}}return{name:s.name,range:s.range||s.version}},i.versionParse=function(s){var o=/^(\*)|(\^|~|>=|>)?\s*((\d+)\.(\d+)\.(\d+))(-[0-9A-Za-z-+]+)?$/;o.test(s)||r.warn("Plugin.versionParse:",s,"is not a valid version or range.");var a=o.exec(s),l=Number(a[4]),u=Number(a[5]),h=Number(a[6]);return{isRange:!!(a[1]||a[2]),version:a[3],range:s,operator:a[1]||a[2]||"",major:l,minor:u,patch:h,parts:[l,u,h],prerelease:a[7],number:l*1e8+u*1e4+h}},i.versionSatisfies=function(s,o){o=o||"*";var a=i.versionParse(o),l=i.versionParse(s);if(a.isRange){if(a.operator==="*"||s==="*")return!0;if(a.operator===">")return l.number>a.number;if(a.operator===">=")return l.number>=a.number;if(a.operator==="~")return l.major===a.major&&l.minor===a.minor&&l.patch>=a.patch;if(a.operator==="^")return a.major>0?l.major===a.major&&l.number>=a.number:a.minor>0?l.minor===a.minor&&l.patch>=a.patch:l.patch===a.patch}return s===o||s==="*"}})()}),(function(n,e){var t={};n.exports=t,(function(){t.create=function(i){return{vertex:i,normalImpulse:0,tangentImpulse:0}}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(7),s=t(18),o=t(13),a=t(19),l=t(5),u=t(6),h=t(10),c=t(0),f=t(4);(function(){i._deltaMax=1e3/60,i.create=function(d){d=d||{};var m={positionIterations:6,velocityIterations:4,constraintIterations:2,enableSleeping:!1,events:[],plugin:{},gravity:{x:0,y:1,scale:.001},timing:{timestamp:0,timeScale:1,lastDelta:0,lastElapsed:0,lastUpdatesPerFrame:0}},x=c.extend(m,d);return x.world=d.world||u.create({label:"World"}),x.pairs=d.pairs||a.create(),x.detector=d.detector||o.create(),x.detector.pairs=x.pairs,x.grid={buckets:[]},x.world.gravity=x.gravity,x.broadphase=x.grid,x.metrics={},x},i.update=function(d,m){var x=c.now(),y=d.world,p=d.detector,_=d.pairs,g=d.timing,v=g.timestamp,M;m>i._deltaMax&&c.warnOnce("Matter.Engine.update: delta argument is recommended to be less than or equal to",i._deltaMax.toFixed(3),"ms."),m=typeof m<"u"?m:c._baseDelta,m*=g.timeScale,g.timestamp+=m,g.lastDelta=m;var S={timestamp:g.timestamp,delta:m};l.trigger(d,"beforeUpdate",S);var E=u.allBodies(y),A=u.allConstraints(y);for(y.isModified&&(o.setBodies(p,E),u.setModified(y,!1,!1,!0)),d.enableSleeping&&r.update(E,m),i._bodiesApplyGravity(E,d.gravity),m>0&&i._bodiesUpdate(E,m),l.trigger(d,"beforeSolve",S),h.preSolveAll(E),M=0;M<d.constraintIterations;M++)h.solveAll(A,m);h.postSolveAll(E);var w=o.collisions(p);a.update(_,w,v),d.enableSleeping&&r.afterCollisions(_.list),_.collisionStart.length>0&&l.trigger(d,"collisionStart",{pairs:_.collisionStart,timestamp:g.timestamp,delta:m});var T=c.clamp(20/d.positionIterations,0,1);for(s.preSolvePosition(_.list),M=0;M<d.positionIterations;M++)s.solvePosition(_.list,m,T);for(s.postSolvePosition(E),h.preSolveAll(E),M=0;M<d.constraintIterations;M++)h.solveAll(A,m);for(h.postSolveAll(E),s.preSolveVelocity(_.list),M=0;M<d.velocityIterations;M++)s.solveVelocity(_.list,m);return i._bodiesUpdateVelocities(E),_.collisionActive.length>0&&l.trigger(d,"collisionActive",{pairs:_.collisionActive,timestamp:g.timestamp,delta:m}),_.collisionEnd.length>0&&l.trigger(d,"collisionEnd",{pairs:_.collisionEnd,timestamp:g.timestamp,delta:m}),i._bodiesClearForces(E),l.trigger(d,"afterUpdate",S),d.timing.lastElapsed=c.now()-x,d},i.merge=function(d,m){if(c.extend(d,m),m.world){d.world=m.world,i.clear(d);for(var x=u.allBodies(d.world),y=0;y<x.length;y++){var p=x[y];r.set(p,!1),p.id=c.nextId()}}},i.clear=function(d){a.clear(d.pairs),o.clear(d.detector)},i._bodiesClearForces=function(d){for(var m=d.length,x=0;x<m;x++){var y=d[x];y.force.x=0,y.force.y=0,y.torque=0}},i._bodiesApplyGravity=function(d,m){var x=typeof m.scale<"u"?m.scale:.001,y=d.length;if(!(m.x===0&&m.y===0||x===0))for(var p=0;p<y;p++){var _=d[p];_.isStatic||_.isSleeping||(_.force.y+=_.mass*m.y*x,_.force.x+=_.mass*m.x*x)}},i._bodiesUpdate=function(d,m){for(var x=d.length,y=0;y<x;y++){var p=d[y];p.isStatic||p.isSleeping||f.update(p,m)}},i._bodiesUpdateVelocities=function(d){for(var m=d.length,x=0;x<m;x++)f.updateVelocities(d[x])}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(3),s=t(0),o=t(1);(function(){i._restingThresh=2,i._restingThreshTangent=Math.sqrt(6),i._positionDampen=.9,i._positionWarming=.8,i._frictionNormalMultiplier=5,i._frictionMaxStatic=Number.MAX_VALUE,i.preSolvePosition=function(a){var l,u,h,c=a.length;for(l=0;l<c;l++)u=a[l],u.isActive&&(h=u.contactCount,u.collision.parentA.totalContacts+=h,u.collision.parentB.totalContacts+=h)},i.solvePosition=function(a,l,u){var h,c,f,d,m,x,y,p,_=i._positionDampen*(u||1),g=s.clamp(l/s._baseDelta,0,1),v=a.length;for(h=0;h<v;h++)c=a[h],!(!c.isActive||c.isSensor)&&(f=c.collision,d=f.parentA,m=f.parentB,x=f.normal,c.separation=f.depth+x.x*(m.positionImpulse.x-d.positionImpulse.x)+x.y*(m.positionImpulse.y-d.positionImpulse.y));for(h=0;h<v;h++)c=a[h],!(!c.isActive||c.isSensor)&&(f=c.collision,d=f.parentA,m=f.parentB,x=f.normal,p=c.separation-c.slop*g,(d.isStatic||m.isStatic)&&(p*=2),d.isStatic||d.isSleeping||(y=_/d.totalContacts,d.positionImpulse.x+=x.x*p*y,d.positionImpulse.y+=x.y*p*y),m.isStatic||m.isSleeping||(y=_/m.totalContacts,m.positionImpulse.x-=x.x*p*y,m.positionImpulse.y-=x.y*p*y))},i.postSolvePosition=function(a){for(var l=i._positionWarming,u=a.length,h=r.translate,c=o.update,f=0;f<u;f++){var d=a[f],m=d.positionImpulse,x=m.x,y=m.y,p=d.velocity;if(d.totalContacts=0,x!==0||y!==0){for(var _=0;_<d.parts.length;_++){var g=d.parts[_];h(g.vertices,m),c(g.bounds,g.vertices,p),g.position.x+=x,g.position.y+=y}d.positionPrev.x+=x,d.positionPrev.y+=y,x*p.x+y*p.y<0?(m.x=0,m.y=0):(m.x*=l,m.y*=l)}}},i.preSolveVelocity=function(a){var l=a.length,u,h;for(u=0;u<l;u++){var c=a[u];if(!(!c.isActive||c.isSensor)){var f=c.contacts,d=c.contactCount,m=c.collision,x=m.parentA,y=m.parentB,p=m.normal,_=m.tangent;for(h=0;h<d;h++){var g=f[h],v=g.vertex,M=g.normalImpulse,S=g.tangentImpulse;if(M!==0||S!==0){var E=p.x*M+_.x*S,A=p.y*M+_.y*S;x.isStatic||x.isSleeping||(x.positionPrev.x+=E*x.inverseMass,x.positionPrev.y+=A*x.inverseMass,x.anglePrev+=x.inverseInertia*((v.x-x.position.x)*A-(v.y-x.position.y)*E)),y.isStatic||y.isSleeping||(y.positionPrev.x-=E*y.inverseMass,y.positionPrev.y-=A*y.inverseMass,y.anglePrev-=y.inverseInertia*((v.x-y.position.x)*A-(v.y-y.position.y)*E))}}}}},i.solveVelocity=function(a,l){var u=l/s._baseDelta,h=u*u,c=h*u,f=-i._restingThresh*u,d=i._restingThreshTangent,m=i._frictionNormalMultiplier*u,x=i._frictionMaxStatic,y=a.length,p,_,g,v;for(g=0;g<y;g++){var M=a[g];if(!(!M.isActive||M.isSensor)){var S=M.collision,E=S.parentA,A=S.parentB,w=S.normal.x,T=S.normal.y,b=S.tangent.x,L=S.tangent.y,D=M.inverseMass,F=M.friction*M.frictionStatic*m,U=M.contacts,O=M.contactCount,Z=1/O,W=E.position.x-E.positionPrev.x,ne=E.position.y-E.positionPrev.y,re=E.angle-E.anglePrev,de=A.position.x-A.positionPrev.x,Ue=A.position.y-A.positionPrev.y,He=A.angle-A.anglePrev;for(v=0;v<O;v++){var Ee=U[v],Ve=Ee.vertex,q=Ve.x-E.position.x,ee=Ve.y-E.position.y,pe=Ve.x-A.position.x,Te=Ve.y-A.position.y,ve=W-ee*re,Xe=ne+q*re,Fe=de-Te*He,I=Ue+pe*He,qe=ve-Fe,De=Xe-I,H=w*qe+T*De,G=b*qe+L*De,te=M.separation+H,J=Math.min(te,1);J=te<0?0:J;var fe=J*F;G<-fe||G>fe?(_=G>0?G:-G,p=M.friction*(G>0?1:-1)*c,p<-_?p=-_:p>_&&(p=_)):(p=G,_=x);var Ie=q*T-ee*w,_e=pe*T-Te*w,P=Z/(D+E.inverseInertia*Ie*Ie+A.inverseInertia*_e*_e),C=(1+M.restitution)*H*P;if(p*=P,H<f)Ee.normalImpulse=0;else{var B=Ee.normalImpulse;Ee.normalImpulse+=C,Ee.normalImpulse>0&&(Ee.normalImpulse=0),C=Ee.normalImpulse-B}if(G<-d||G>d)Ee.tangentImpulse=0;else{var K=Ee.tangentImpulse;Ee.tangentImpulse+=p,Ee.tangentImpulse<-_&&(Ee.tangentImpulse=-_),Ee.tangentImpulse>_&&(Ee.tangentImpulse=_),p=Ee.tangentImpulse-K}var Q=w*C+b*p,$=T*C+L*p;E.isStatic||E.isSleeping||(E.positionPrev.x+=Q*E.inverseMass,E.positionPrev.y+=$*E.inverseMass,E.anglePrev+=(q*$-ee*Q)*E.inverseInertia),A.isStatic||A.isSleeping||(A.positionPrev.x-=Q*A.inverseMass,A.positionPrev.y-=$*A.inverseMass,A.anglePrev-=(pe*$-Te*Q)*A.inverseInertia)}}}}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(9),s=t(0);(function(){i.create=function(o){return s.extend({table:{},list:[],collisionStart:[],collisionActive:[],collisionEnd:[]},o)},i.update=function(o,a,l){var u=r.update,h=r.create,c=r.setActive,f=o.table,d=o.list,m=d.length,x=m,y=o.collisionStart,p=o.collisionEnd,_=o.collisionActive,g=a.length,v=0,M=0,S=0,E,A,w;for(w=0;w<g;w++)E=a[w],A=E.pair,A?(A.isActive&&(_[S++]=A),u(A,E,l)):(A=h(E,l),f[A.id]=A,y[v++]=A,d[x++]=A);for(x=0,m=d.length,w=0;w<m;w++)A=d[w],A.timeUpdated>=l?d[x++]=A:(c(A,!1,l),A.collision.bodyA.sleepCounter>0&&A.collision.bodyB.sleepCounter>0?d[x++]=A:(p[M++]=A,delete f[A.id]));d.length!==x&&(d.length=x),y.length!==v&&(y.length=v),p.length!==M&&(p.length=M),_.length!==S&&(_.length=S)},i.clear=function(o){return o.table={},o.list.length=0,o.collisionStart.length=0,o.collisionActive.length=0,o.collisionEnd.length=0,o}})()}),(function(n,e,t){var i=n.exports=t(21);i.Axes=t(11),i.Bodies=t(12),i.Body=t(4),i.Bounds=t(1),i.Collision=t(8),i.Common=t(0),i.Composite=t(6),i.Composites=t(22),i.Constraint=t(10),i.Contact=t(16),i.Detector=t(13),i.Engine=t(17),i.Events=t(5),i.Grid=t(23),i.Mouse=t(14),i.MouseConstraint=t(24),i.Pair=t(9),i.Pairs=t(19),i.Plugin=t(15),i.Query=t(25),i.Render=t(26),i.Resolver=t(18),i.Runner=t(27),i.SAT=t(28),i.Sleeping=t(7),i.Svg=t(29),i.Vector=t(2),i.Vertices=t(3),i.World=t(30),i.Engine.run=i.Runner.run,i.Common.deprecated(i.Engine,"run","Engine.run \u27A4 use Matter.Runner.run(engine) instead")}),(function(n,e,t){var i={};n.exports=i;var r=t(15),s=t(0);(function(){i.name="matter-js",i.version="0.20.0",i.uses=[],i.used=[],i.use=function(){r.use(i,Array.prototype.slice.call(arguments))},i.before=function(o,a){return o=o.replace(/^Matter./,""),s.chainPathBefore(i,o,a)},i.after=function(o,a){return o=o.replace(/^Matter./,""),s.chainPathAfter(i,o,a)}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(6),s=t(10),o=t(0),a=t(4),l=t(12),u=o.deprecated;(function(){i.stack=function(h,c,f,d,m,x,y){for(var p=r.create({label:"Stack"}),_=h,g=c,v,M=0,S=0;S<d;S++){for(var E=0,A=0;A<f;A++){var w=y(_,g,A,S,v,M);if(w){var T=w.bounds.max.y-w.bounds.min.y,b=w.bounds.max.x-w.bounds.min.x;T>E&&(E=T),a.translate(w,{x:b*.5,y:T*.5}),_=w.bounds.max.x+m,r.addBody(p,w),v=w,M+=1}else _+=m}g+=E+x,_=h}return p},i.chain=function(h,c,f,d,m,x){for(var y=h.bodies,p=1;p<y.length;p++){var _=y[p-1],g=y[p],v=_.bounds.max.y-_.bounds.min.y,M=_.bounds.max.x-_.bounds.min.x,S=g.bounds.max.y-g.bounds.min.y,E=g.bounds.max.x-g.bounds.min.x,A={bodyA:_,pointA:{x:M*c,y:v*f},bodyB:g,pointB:{x:E*d,y:S*m}},w=o.extend(A,x);r.addConstraint(h,s.create(w))}return h.label+=" Chain",h},i.mesh=function(h,c,f,d,m){var x=h.bodies,y,p,_,g,v;for(y=0;y<f;y++){for(p=1;p<c;p++)_=x[p-1+y*c],g=x[p+y*c],r.addConstraint(h,s.create(o.extend({bodyA:_,bodyB:g},m)));if(y>0)for(p=0;p<c;p++)_=x[p+(y-1)*c],g=x[p+y*c],r.addConstraint(h,s.create(o.extend({bodyA:_,bodyB:g},m))),d&&p>0&&(v=x[p-1+(y-1)*c],r.addConstraint(h,s.create(o.extend({bodyA:v,bodyB:g},m)))),d&&p<c-1&&(v=x[p+1+(y-1)*c],r.addConstraint(h,s.create(o.extend({bodyA:v,bodyB:g},m))))}return h.label+=" Mesh",h},i.pyramid=function(h,c,f,d,m,x,y){return i.stack(h,c,f,d,m,x,function(p,_,g,v,M,S){var E=Math.min(d,Math.ceil(f/2)),A=M?M.bounds.max.x-M.bounds.min.x:0;if(!(v>E)){v=E-v;var w=v,T=f-1-v;if(!(g<w||g>T)){S===1&&a.translate(M,{x:(g+(f%2===1?1:-1))*A,y:0});var b=M?g*A:0;return y(h+b+g*m,_,g,v,M,S)}}})},i.newtonsCradle=function(h,c,f,d,m){for(var x=r.create({label:"Newtons Cradle"}),y=0;y<f;y++){var p=1.9,_=l.circle(h+y*(d*p),c+m,d,{inertia:1/0,restitution:1,friction:0,frictionAir:1e-4,slop:1}),g=s.create({pointA:{x:h+y*(d*p),y:c},bodyB:_});r.addBody(x,_),r.addConstraint(x,g)}return x},u(i,"newtonsCradle","Composites.newtonsCradle \u27A4 moved to newtonsCradle example"),i.car=function(h,c,f,d,m){var x=a.nextGroup(!0),y=20,p=-f*.5+y,_=f*.5-y,g=0,v=r.create({label:"Car"}),M=l.rectangle(h,c,f,d,{collisionFilter:{group:x},chamfer:{radius:d*.5},density:2e-4}),S=l.circle(h+p,c+g,m,{collisionFilter:{group:x},friction:.8}),E=l.circle(h+_,c+g,m,{collisionFilter:{group:x},friction:.8}),A=s.create({bodyB:M,pointB:{x:p,y:g},bodyA:S,stiffness:1,length:0}),w=s.create({bodyB:M,pointB:{x:_,y:g},bodyA:E,stiffness:1,length:0});return r.addBody(v,M),r.addBody(v,S),r.addBody(v,E),r.addConstraint(v,A),r.addConstraint(v,w),v},u(i,"car","Composites.car \u27A4 moved to car example"),i.softBody=function(h,c,f,d,m,x,y,p,_,g){_=o.extend({inertia:1/0},_),g=o.extend({stiffness:.2,render:{type:"line",anchors:!1}},g);var v=i.stack(h,c,f,d,m,x,function(M,S){return l.circle(M,S,p,_)});return i.mesh(v,f,d,y,g),v.label="Soft Body",v},u(i,"softBody","Composites.softBody \u27A4 moved to softBody and cloth examples")})()}),(function(n,e,t){var i={};n.exports=i;var r=t(9),s=t(0),o=s.deprecated;(function(){i.create=function(a){var l={buckets:{},pairs:{},pairsList:[],bucketWidth:48,bucketHeight:48};return s.extend(l,a)},i.update=function(a,l,u,h){var c,f,d,m=u.world,x=a.buckets,y,p,_=!1;for(c=0;c<l.length;c++){var g=l[c];if(!(g.isSleeping&&!h)&&!(m.bounds&&(g.bounds.max.x<m.bounds.min.x||g.bounds.min.x>m.bounds.max.x||g.bounds.max.y<m.bounds.min.y||g.bounds.min.y>m.bounds.max.y))){var v=i._getRegion(a,g);if(!g.region||v.id!==g.region.id||h){(!g.region||h)&&(g.region=v);var M=i._regionUnion(v,g.region);for(f=M.startCol;f<=M.endCol;f++)for(d=M.startRow;d<=M.endRow;d++){p=i._getBucketId(f,d),y=x[p];var S=f>=v.startCol&&f<=v.endCol&&d>=v.startRow&&d<=v.endRow,E=f>=g.region.startCol&&f<=g.region.endCol&&d>=g.region.startRow&&d<=g.region.endRow;!S&&E&&E&&y&&i._bucketRemoveBody(a,y,g),(g.region===v||S&&!E||h)&&(y||(y=i._createBucket(x,p)),i._bucketAddBody(a,y,g))}g.region=v,_=!0}}}_&&(a.pairsList=i._createActivePairsList(a))},o(i,"update","Grid.update \u27A4 replaced by Matter.Detector"),i.clear=function(a){a.buckets={},a.pairs={},a.pairsList=[]},o(i,"clear","Grid.clear \u27A4 replaced by Matter.Detector"),i._regionUnion=function(a,l){var u=Math.min(a.startCol,l.startCol),h=Math.max(a.endCol,l.endCol),c=Math.min(a.startRow,l.startRow),f=Math.max(a.endRow,l.endRow);return i._createRegion(u,h,c,f)},i._getRegion=function(a,l){var u=l.bounds,h=Math.floor(u.min.x/a.bucketWidth),c=Math.floor(u.max.x/a.bucketWidth),f=Math.floor(u.min.y/a.bucketHeight),d=Math.floor(u.max.y/a.bucketHeight);return i._createRegion(h,c,f,d)},i._createRegion=function(a,l,u,h){return{id:a+","+l+","+u+","+h,startCol:a,endCol:l,startRow:u,endRow:h}},i._getBucketId=function(a,l){return"C"+a+"R"+l},i._createBucket=function(a,l){var u=a[l]=[];return u},i._bucketAddBody=function(a,l,u){var h=a.pairs,c=r.id,f=l.length,d;for(d=0;d<f;d++){var m=l[d];if(!(u.id===m.id||u.isStatic&&m.isStatic)){var x=c(u,m),y=h[x];y?y[2]+=1:h[x]=[u,m,1]}}l.push(u)},i._bucketRemoveBody=function(a,l,u){var h=a.pairs,c=r.id,f;l.splice(s.indexOf(l,u),1);var d=l.length;for(f=0;f<d;f++){var m=h[c(u,l[f])];m&&(m[2]-=1)}},i._createActivePairsList=function(a){var l,u=a.pairs,h=s.keys(u),c=h.length,f=[],d;for(d=0;d<c;d++)l=u[h[d]],l[2]>0?f.push(l):delete u[h[d]];return f}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(3),s=t(7),o=t(14),a=t(5),l=t(13),u=t(10),h=t(6),c=t(0),f=t(1);(function(){i.create=function(d,m){var x=(d?d.mouse:null)||(m?m.mouse:null);x||(d&&d.render&&d.render.canvas?x=o.create(d.render.canvas):m&&m.element?x=o.create(m.element):(x=o.create(),c.warn("MouseConstraint.create: options.mouse was undefined, options.element was undefined, may not function as expected")));var y=u.create({label:"Mouse Constraint",pointA:x.position,pointB:{x:0,y:0},length:.01,stiffness:.1,angularStiffness:1,render:{strokeStyle:"#90EE90",lineWidth:3}}),p={type:"mouseConstraint",mouse:x,element:null,body:null,constraint:y,collisionFilter:{category:1,mask:4294967295,group:0}},_=c.extend(p,m);return a.on(d,"beforeUpdate",function(){var g=h.allBodies(d.world);i.update(_,g),i._triggerEvents(_)}),_},i.update=function(d,m){var x=d.mouse,y=d.constraint,p=d.body;if(x.button===0){if(y.bodyB)s.set(y.bodyB,!1),y.pointA=x.position;else for(var _=0;_<m.length;_++)if(p=m[_],f.contains(p.bounds,x.position)&&l.canCollide(p.collisionFilter,d.collisionFilter))for(var g=p.parts.length>1?1:0;g<p.parts.length;g++){var v=p.parts[g];if(r.contains(v.vertices,x.position)){y.pointA=x.position,y.bodyB=d.body=p,y.pointB={x:x.position.x-p.position.x,y:x.position.y-p.position.y},y.angleB=p.angle,s.set(p,!1),a.trigger(d,"startdrag",{mouse:x,body:p});break}}}else y.bodyB=d.body=null,y.pointB=null,p&&a.trigger(d,"enddrag",{mouse:x,body:p})},i._triggerEvents=function(d){var m=d.mouse,x=m.sourceEvents;x.mousemove&&a.trigger(d,"mousemove",{mouse:m}),x.mousedown&&a.trigger(d,"mousedown",{mouse:m}),x.mouseup&&a.trigger(d,"mouseup",{mouse:m}),o.clearSourceEvents(m)}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(2),s=t(8),o=t(1),a=t(12),l=t(3);(function(){i.collides=function(u,h){for(var c=[],f=h.length,d=u.bounds,m=s.collides,x=o.overlaps,y=0;y<f;y++){var p=h[y],_=p.parts.length,g=_===1?0:1;if(x(p.bounds,d))for(var v=g;v<_;v++){var M=p.parts[v];if(x(M.bounds,d)){var S=m(M,u);if(S){c.push(S);break}}}}return c},i.ray=function(u,h,c,f){f=f||1e-100;for(var d=r.angle(h,c),m=r.magnitude(r.sub(h,c)),x=(c.x+h.x)*.5,y=(c.y+h.y)*.5,p=a.rectangle(x,y,m,f,{angle:d}),_=i.collides(p,u),g=0;g<_.length;g+=1){var v=_[g];v.body=v.bodyB=v.bodyA}return _},i.region=function(u,h,c){for(var f=[],d=0;d<u.length;d++){var m=u[d],x=o.overlaps(m.bounds,h);(x&&!c||!x&&c)&&f.push(m)}return f},i.point=function(u,h){for(var c=[],f=0;f<u.length;f++){var d=u[f];if(o.contains(d.bounds,h))for(var m=d.parts.length===1?0:1;m<d.parts.length;m++){var x=d.parts[m];if(o.contains(x.bounds,h)&&l.contains(x.vertices,h)){c.push(d);break}}}return c}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(4),s=t(0),o=t(6),a=t(1),l=t(5),u=t(2),h=t(14);(function(){var c,f;typeof window<"u"&&(c=window.requestAnimationFrame||window.webkitRequestAnimationFrame||window.mozRequestAnimationFrame||window.msRequestAnimationFrame||function(g){window.setTimeout(function(){g(s.now())},1e3/60)},f=window.cancelAnimationFrame||window.mozCancelAnimationFrame||window.webkitCancelAnimationFrame||window.msCancelAnimationFrame),i._goodFps=30,i._goodDelta=1e3/60,i.create=function(g){var v={engine:null,element:null,canvas:null,mouse:null,frameRequestId:null,timing:{historySize:60,delta:0,deltaHistory:[],lastTime:0,lastTimestamp:0,lastElapsed:0,timestampElapsed:0,timestampElapsedHistory:[],engineDeltaHistory:[],engineElapsedHistory:[],engineUpdatesHistory:[],elapsedHistory:[]},options:{width:800,height:600,pixelRatio:1,background:"#14151f",wireframeBackground:"#14151f",wireframeStrokeStyle:"#bbb",hasBounds:!!g.bounds,enabled:!0,wireframes:!0,showSleeping:!0,showDebug:!1,showStats:!1,showPerformance:!1,showBounds:!1,showVelocity:!1,showCollisions:!1,showSeparations:!1,showAxes:!1,showPositions:!1,showAngleIndicator:!1,showIds:!1,showVertexNumbers:!1,showConvexHulls:!1,showInternalEdges:!1,showMousePosition:!1}},M=s.extend(v,g);return M.canvas&&(M.canvas.width=M.options.width||M.canvas.width,M.canvas.height=M.options.height||M.canvas.height),M.mouse=g.mouse,M.engine=g.engine,M.canvas=M.canvas||x(M.options.width,M.options.height),M.context=M.canvas.getContext("2d"),M.textures={},M.bounds=M.bounds||{min:{x:0,y:0},max:{x:M.canvas.width,y:M.canvas.height}},M.controller=i,M.options.showBroadphase=!1,M.options.pixelRatio!==1&&i.setPixelRatio(M,M.options.pixelRatio),s.isElement(M.element)&&M.element.appendChild(M.canvas),M},i.run=function(g){(function v(M){g.frameRequestId=c(v),d(g,M),i.world(g,M),g.context.setTransform(g.options.pixelRatio,0,0,g.options.pixelRatio,0,0),(g.options.showStats||g.options.showDebug)&&i.stats(g,g.context,M),(g.options.showPerformance||g.options.showDebug)&&i.performance(g,g.context,M),g.context.setTransform(1,0,0,1,0,0)})()},i.stop=function(g){f(g.frameRequestId)},i.setPixelRatio=function(g,v){var M=g.options,S=g.canvas;v==="auto"&&(v=y(S)),M.pixelRatio=v,S.setAttribute("data-pixel-ratio",v),S.width=M.width*v,S.height=M.height*v,S.style.width=M.width+"px",S.style.height=M.height+"px"},i.setSize=function(g,v,M){g.options.width=v,g.options.height=M,g.bounds.max.x=g.bounds.min.x+v,g.bounds.max.y=g.bounds.min.y+M,g.options.pixelRatio!==1?i.setPixelRatio(g,g.options.pixelRatio):(g.canvas.width=v,g.canvas.height=M)},i.lookAt=function(g,v,M,S){S=typeof S<"u"?S:!0,v=s.isArray(v)?v:[v],M=M||{x:0,y:0};for(var E={min:{x:1/0,y:1/0},max:{x:-1/0,y:-1/0}},A=0;A<v.length;A+=1){var w=v[A],T=w.bounds?w.bounds.min:w.min||w.position||w,b=w.bounds?w.bounds.max:w.max||w.position||w;T&&b&&(T.x<E.min.x&&(E.min.x=T.x),b.x>E.max.x&&(E.max.x=b.x),T.y<E.min.y&&(E.min.y=T.y),b.y>E.max.y&&(E.max.y=b.y))}var L=E.max.x-E.min.x+2*M.x,D=E.max.y-E.min.y+2*M.y,F=g.canvas.height,U=g.canvas.width,O=U/F,Z=L/D,W=1,ne=1;Z>O?ne=Z/O:W=O/Z,g.options.hasBounds=!0,g.bounds.min.x=E.min.x,g.bounds.max.x=E.min.x+L*W,g.bounds.min.y=E.min.y,g.bounds.max.y=E.min.y+D*ne,S&&(g.bounds.min.x+=L*.5-L*W*.5,g.bounds.max.x+=L*.5-L*W*.5,g.bounds.min.y+=D*.5-D*ne*.5,g.bounds.max.y+=D*.5-D*ne*.5),g.bounds.min.x-=M.x,g.bounds.max.x-=M.x,g.bounds.min.y-=M.y,g.bounds.max.y-=M.y,g.mouse&&(h.setScale(g.mouse,{x:(g.bounds.max.x-g.bounds.min.x)/g.canvas.width,y:(g.bounds.max.y-g.bounds.min.y)/g.canvas.height}),h.setOffset(g.mouse,g.bounds.min))},i.startViewTransform=function(g){var v=g.bounds.max.x-g.bounds.min.x,M=g.bounds.max.y-g.bounds.min.y,S=v/g.options.width,E=M/g.options.height;g.context.setTransform(g.options.pixelRatio/S,0,0,g.options.pixelRatio/E,0,0),g.context.translate(-g.bounds.min.x,-g.bounds.min.y)},i.endViewTransform=function(g){g.context.setTransform(g.options.pixelRatio,0,0,g.options.pixelRatio,0,0)},i.world=function(g,v){var M=s.now(),S=g.engine,E=S.world,A=g.canvas,w=g.context,T=g.options,b=g.timing,L=o.allBodies(E),D=o.allConstraints(E),F=T.wireframes?T.wireframeBackground:T.background,U=[],O=[],Z,W={timestamp:S.timing.timestamp};if(l.trigger(g,"beforeRender",W),g.currentBackground!==F&&_(g,F),w.globalCompositeOperation="source-in",w.fillStyle="transparent",w.fillRect(0,0,A.width,A.height),w.globalCompositeOperation="source-over",T.hasBounds){for(Z=0;Z<L.length;Z++){var ne=L[Z];a.overlaps(ne.bounds,g.bounds)&&U.push(ne)}for(Z=0;Z<D.length;Z++){var re=D[Z],de=re.bodyA,Ue=re.bodyB,He=re.pointA,Ee=re.pointB;de&&(He=u.add(de.position,re.pointA)),Ue&&(Ee=u.add(Ue.position,re.pointB)),!(!He||!Ee)&&(a.contains(g.bounds,He)||a.contains(g.bounds,Ee))&&O.push(re)}i.startViewTransform(g),g.mouse&&(h.setScale(g.mouse,{x:(g.bounds.max.x-g.bounds.min.x)/g.options.width,y:(g.bounds.max.y-g.bounds.min.y)/g.options.height}),h.setOffset(g.mouse,g.bounds.min))}else O=D,U=L,g.options.pixelRatio!==1&&g.context.setTransform(g.options.pixelRatio,0,0,g.options.pixelRatio,0,0);!T.wireframes||S.enableSleeping&&T.showSleeping?i.bodies(g,U,w):(T.showConvexHulls&&i.bodyConvexHulls(g,U,w),i.bodyWireframes(g,U,w)),T.showBounds&&i.bodyBounds(g,U,w),(T.showAxes||T.showAngleIndicator)&&i.bodyAxes(g,U,w),T.showPositions&&i.bodyPositions(g,U,w),T.showVelocity&&i.bodyVelocity(g,U,w),T.showIds&&i.bodyIds(g,U,w),T.showSeparations&&i.separations(g,S.pairs.list,w),T.showCollisions&&i.collisions(g,S.pairs.list,w),T.showVertexNumbers&&i.vertexNumbers(g,U,w),T.showMousePosition&&i.mousePosition(g,g.mouse,w),i.constraints(O,w),T.hasBounds&&i.endViewTransform(g),l.trigger(g,"afterRender",W),b.lastElapsed=s.now()-M},i.stats=function(g,v,M){for(var S=g.engine,E=S.world,A=o.allBodies(E),w=0,T=55,b=44,L=0,D=0,F=0;F<A.length;F+=1)w+=A[F].parts.length;var U={Part:w,Body:A.length,Cons:o.allConstraints(E).length,Comp:o.allComposites(E).length,Pair:S.pairs.list.length};v.fillStyle="#0e0f19",v.fillRect(L,D,T*5.5,b),v.font="12px Arial",v.textBaseline="top",v.textAlign="right";for(var O in U){var Z=U[O];v.fillStyle="#aaa",v.fillText(O,L+T,D+8),v.fillStyle="#eee",v.fillText(Z,L+T,D+26),L+=T}},i.performance=function(g,v){var M=g.engine,S=g.timing,E=S.deltaHistory,A=S.elapsedHistory,w=S.timestampElapsedHistory,T=S.engineDeltaHistory,b=S.engineUpdatesHistory,L=S.engineElapsedHistory,D=M.timing.lastUpdatesPerFrame,F=M.timing.lastDelta,U=m(E),O=m(A),Z=m(T),W=m(b),ne=m(L),re=m(w),de=re/U||0,Ue=Math.round(U/F),He=1e3/U||0,Ee=4,Ve=12,q=60,ee=34,pe=10,Te=69;v.fillStyle="#0e0f19",v.fillRect(0,50,Ve*5+q*6+22,ee),i.status(v,pe,Te,q,Ee,E.length,Math.round(He)+" fps",He/i._goodFps,function(ve){return E[ve]/U-1}),i.status(v,pe+Ve+q,Te,q,Ee,T.length,F.toFixed(2)+" dt",i._goodDelta/F,function(ve){return T[ve]/Z-1}),i.status(v,pe+(Ve+q)*2,Te,q,Ee,b.length,D+" upf",Math.pow(s.clamp(W/Ue||1,0,1),4),function(ve){return b[ve]/W-1}),i.status(v,pe+(Ve+q)*3,Te,q,Ee,L.length,ne.toFixed(2)+" ut",1-D*ne/i._goodFps,function(ve){return L[ve]/ne-1}),i.status(v,pe+(Ve+q)*4,Te,q,Ee,A.length,O.toFixed(2)+" rt",1-O/i._goodFps,function(ve){return A[ve]/O-1}),i.status(v,pe+(Ve+q)*5,Te,q,Ee,w.length,de.toFixed(2)+" x",de*de*de,function(ve){return(w[ve]/E[ve]/de||0)-1})},i.status=function(g,v,M,S,E,A,w,T,b){g.strokeStyle="#888",g.fillStyle="#444",g.lineWidth=1,g.fillRect(v,M+7,S,1),g.beginPath(),g.moveTo(v,M+7-E*s.clamp(.4*b(0),-2,2));for(var L=0;L<S;L+=1)g.lineTo(v+L,M+7-(L<A?E*s.clamp(.4*b(L),-2,2):0));g.stroke(),g.fillStyle="hsl("+s.clamp(25+95*T,0,120)+",100%,60%)",g.fillRect(v,M-7,4,4),g.font="12px Arial",g.textBaseline="middle",g.textAlign="right",g.fillStyle="#eee",g.fillText(w,v+S,M-5)},i.constraints=function(g,v){for(var M=v,S=0;S<g.length;S++){var E=g[S];if(!(!E.render.visible||!E.pointA||!E.pointB)){var A=E.bodyA,w=E.bodyB,T,b;if(A?T=u.add(A.position,E.pointA):T=E.pointA,E.render.type==="pin")M.beginPath(),M.arc(T.x,T.y,3,0,2*Math.PI),M.closePath();else{if(w?b=u.add(w.position,E.pointB):b=E.pointB,M.beginPath(),M.moveTo(T.x,T.y),E.render.type==="spring")for(var L=u.sub(b,T),D=u.perp(u.normalise(L)),F=Math.ceil(s.clamp(E.length/5,12,20)),U,O=1;O<F;O+=1)U=O%2===0?1:-1,M.lineTo(T.x+L.x*(O/F)+D.x*U*4,T.y+L.y*(O/F)+D.y*U*4);M.lineTo(b.x,b.y)}E.render.lineWidth&&(M.lineWidth=E.render.lineWidth,M.strokeStyle=E.render.strokeStyle,M.stroke()),E.render.anchors&&(M.fillStyle=E.render.strokeStyle,M.beginPath(),M.arc(T.x,T.y,3,0,2*Math.PI),M.arc(b.x,b.y,3,0,2*Math.PI),M.closePath(),M.fill())}}},i.bodies=function(g,v,M){var S=M,E=g.engine,A=g.options,w=A.showInternalEdges||!A.wireframes,T,b,L,D;for(L=0;L<v.length;L++)if(T=v[L],!!T.render.visible){for(D=T.parts.length>1?1:0;D<T.parts.length;D++)if(b=T.parts[D],!!b.render.visible){if(A.showSleeping&&T.isSleeping?S.globalAlpha=.5*b.render.opacity:b.render.opacity!==1&&(S.globalAlpha=b.render.opacity),b.render.sprite&&b.render.sprite.texture&&!A.wireframes){var F=b.render.sprite,U=p(g,F.texture);S.translate(b.position.x,b.position.y),S.rotate(b.angle),S.drawImage(U,U.width*-F.xOffset*F.xScale,U.height*-F.yOffset*F.yScale,U.width*F.xScale,U.height*F.yScale),S.rotate(-b.angle),S.translate(-b.position.x,-b.position.y)}else{if(b.circleRadius)S.beginPath(),S.arc(b.position.x,b.position.y,b.circleRadius,0,2*Math.PI);else{S.beginPath(),S.moveTo(b.vertices[0].x,b.vertices[0].y);for(var O=1;O<b.vertices.length;O++)!b.vertices[O-1].isInternal||w?S.lineTo(b.vertices[O].x,b.vertices[O].y):S.moveTo(b.vertices[O].x,b.vertices[O].y),b.vertices[O].isInternal&&!w&&S.moveTo(b.vertices[(O+1)%b.vertices.length].x,b.vertices[(O+1)%b.vertices.length].y);S.lineTo(b.vertices[0].x,b.vertices[0].y),S.closePath()}A.wireframes?(S.lineWidth=1,S.strokeStyle=g.options.wireframeStrokeStyle,S.stroke()):(S.fillStyle=b.render.fillStyle,b.render.lineWidth&&(S.lineWidth=b.render.lineWidth,S.strokeStyle=b.render.strokeStyle,S.stroke()),S.fill())}S.globalAlpha=1}}},i.bodyWireframes=function(g,v,M){var S=M,E=g.options.showInternalEdges,A,w,T,b,L;for(S.beginPath(),T=0;T<v.length;T++)if(A=v[T],!!A.render.visible)for(L=A.parts.length>1?1:0;L<A.parts.length;L++){for(w=A.parts[L],S.moveTo(w.vertices[0].x,w.vertices[0].y),b=1;b<w.vertices.length;b++)!w.vertices[b-1].isInternal||E?S.lineTo(w.vertices[b].x,w.vertices[b].y):S.moveTo(w.vertices[b].x,w.vertices[b].y),w.vertices[b].isInternal&&!E&&S.moveTo(w.vertices[(b+1)%w.vertices.length].x,w.vertices[(b+1)%w.vertices.length].y);S.lineTo(w.vertices[0].x,w.vertices[0].y)}S.lineWidth=1,S.strokeStyle=g.options.wireframeStrokeStyle,S.stroke()},i.bodyConvexHulls=function(g,v,M){var S=M,E,A,w,T,b;for(S.beginPath(),w=0;w<v.length;w++)if(E=v[w],!(!E.render.visible||E.parts.length===1)){for(S.moveTo(E.vertices[0].x,E.vertices[0].y),T=1;T<E.vertices.length;T++)S.lineTo(E.vertices[T].x,E.vertices[T].y);S.lineTo(E.vertices[0].x,E.vertices[0].y)}S.lineWidth=1,S.strokeStyle="rgba(255,255,255,0.2)",S.stroke()},i.vertexNumbers=function(g,v,M){var S=M,E,A,w;for(E=0;E<v.length;E++){var T=v[E].parts;for(w=T.length>1?1:0;w<T.length;w++){var b=T[w];for(A=0;A<b.vertices.length;A++)S.fillStyle="rgba(255,255,255,0.2)",S.fillText(E+"_"+A,b.position.x+(b.vertices[A].x-b.position.x)*.8,b.position.y+(b.vertices[A].y-b.position.y)*.8)}}},i.mousePosition=function(g,v,M){var S=M;S.fillStyle="rgba(255,255,255,0.8)",S.fillText(v.position.x+"  "+v.position.y,v.position.x+5,v.position.y-5)},i.bodyBounds=function(g,v,M){var S=M,E=g.engine,A=g.options;S.beginPath();for(var w=0;w<v.length;w++){var T=v[w];if(T.render.visible)for(var b=v[w].parts,L=b.length>1?1:0;L<b.length;L++){var D=b[L];S.rect(D.bounds.min.x,D.bounds.min.y,D.bounds.max.x-D.bounds.min.x,D.bounds.max.y-D.bounds.min.y)}}A.wireframes?S.strokeStyle="rgba(255,255,255,0.08)":S.strokeStyle="rgba(0,0,0,0.1)",S.lineWidth=1,S.stroke()},i.bodyAxes=function(g,v,M){var S=M,E=g.engine,A=g.options,w,T,b,L;for(S.beginPath(),T=0;T<v.length;T++){var D=v[T],F=D.parts;if(D.render.visible)if(A.showAxes)for(b=F.length>1?1:0;b<F.length;b++)for(w=F[b],L=0;L<w.axes.length;L++){var U=w.axes[L];S.moveTo(w.position.x,w.position.y),S.lineTo(w.position.x+U.x*20,w.position.y+U.y*20)}else for(b=F.length>1?1:0;b<F.length;b++)for(w=F[b],L=0;L<w.axes.length;L++)S.moveTo(w.position.x,w.position.y),S.lineTo((w.vertices[0].x+w.vertices[w.vertices.length-1].x)/2,(w.vertices[0].y+w.vertices[w.vertices.length-1].y)/2)}A.wireframes?(S.strokeStyle="indianred",S.lineWidth=1):(S.strokeStyle="rgba(255, 255, 255, 0.4)",S.globalCompositeOperation="overlay",S.lineWidth=2),S.stroke(),S.globalCompositeOperation="source-over"},i.bodyPositions=function(g,v,M){var S=M,E=g.engine,A=g.options,w,T,b,L;for(S.beginPath(),b=0;b<v.length;b++)if(w=v[b],!!w.render.visible)for(L=0;L<w.parts.length;L++)T=w.parts[L],S.arc(T.position.x,T.position.y,3,0,2*Math.PI,!1),S.closePath();for(A.wireframes?S.fillStyle="indianred":S.fillStyle="rgba(0,0,0,0.5)",S.fill(),S.beginPath(),b=0;b<v.length;b++)w=v[b],w.render.visible&&(S.arc(w.positionPrev.x,w.positionPrev.y,2,0,2*Math.PI,!1),S.closePath());S.fillStyle="rgba(255,165,0,0.8)",S.fill()},i.bodyVelocity=function(g,v,M){var S=M;S.beginPath();for(var E=0;E<v.length;E++){var A=v[E];if(A.render.visible){var w=r.getVelocity(A);S.moveTo(A.position.x,A.position.y),S.lineTo(A.position.x+w.x,A.position.y+w.y)}}S.lineWidth=3,S.strokeStyle="cornflowerblue",S.stroke()},i.bodyIds=function(g,v,M){var S=M,E,A;for(E=0;E<v.length;E++)if(v[E].render.visible){var w=v[E].parts;for(A=w.length>1?1:0;A<w.length;A++){var T=w[A];S.font="12px Arial",S.fillStyle="rgba(255,255,255,0.5)",S.fillText(T.id,T.position.x+10,T.position.y-10)}}},i.collisions=function(g,v,M){var S=M,E=g.options,A,w,T,b,L,D,F;for(S.beginPath(),D=0;D<v.length;D++)if(A=v[D],!!A.isActive)for(w=A.collision,F=0;F<A.contactCount;F++){var U=A.contacts[F],O=U.vertex;S.rect(O.x-1.5,O.y-1.5,3.5,3.5)}for(E.wireframes?S.fillStyle="rgba(255,255,255,0.7)":S.fillStyle="orange",S.fill(),S.beginPath(),D=0;D<v.length;D++)if(A=v[D],!!A.isActive&&(w=A.collision,A.contactCount>0)){var Z=A.contacts[0].vertex.x,W=A.contacts[0].vertex.y;A.contactCount===2&&(Z=(A.contacts[0].vertex.x+A.contacts[1].vertex.x)/2,W=(A.contacts[0].vertex.y+A.contacts[1].vertex.y)/2),w.bodyB===w.supports[0].body||w.bodyA.isStatic===!0?S.moveTo(Z-w.normal.x*8,W-w.normal.y*8):S.moveTo(Z+w.normal.x*8,W+w.normal.y*8),S.lineTo(Z,W)}E.wireframes?S.strokeStyle="rgba(255,165,0,0.7)":S.strokeStyle="orange",S.lineWidth=1,S.stroke()},i.separations=function(g,v,M){var S=M,E=g.options,A,w,T,b,L,D,F;for(S.beginPath(),D=0;D<v.length;D++)if(A=v[D],!!A.isActive){w=A.collision,b=w.bodyA,L=w.bodyB;var U=1;!L.isStatic&&!b.isStatic&&(U=.5),L.isStatic&&(U=0),S.moveTo(L.position.x,L.position.y),S.lineTo(L.position.x-w.penetration.x*U,L.position.y-w.penetration.y*U),U=1,!L.isStatic&&!b.isStatic&&(U=.5),b.isStatic&&(U=0),S.moveTo(b.position.x,b.position.y),S.lineTo(b.position.x+w.penetration.x*U,b.position.y+w.penetration.y*U)}E.wireframes?S.strokeStyle="rgba(255,165,0,0.5)":S.strokeStyle="orange",S.stroke()},i.inspector=function(g,v){var M=g.engine,S=g.selected,E=g.render,A=E.options,w;if(A.hasBounds){var T=E.bounds.max.x-E.bounds.min.x,b=E.bounds.max.y-E.bounds.min.y,L=T/E.options.width,D=b/E.options.height;v.scale(1/L,1/D),v.translate(-E.bounds.min.x,-E.bounds.min.y)}for(var F=0;F<S.length;F++){var U=S[F].data;switch(v.translate(.5,.5),v.lineWidth=1,v.strokeStyle="rgba(255,165,0,0.9)",v.setLineDash([1,2]),U.type){case"body":w=U.bounds,v.beginPath(),v.rect(Math.floor(w.min.x-3),Math.floor(w.min.y-3),Math.floor(w.max.x-w.min.x+6),Math.floor(w.max.y-w.min.y+6)),v.closePath(),v.stroke();break;case"constraint":var O=U.pointA;U.bodyA&&(O=U.pointB),v.beginPath(),v.arc(O.x,O.y,10,0,2*Math.PI),v.closePath(),v.stroke();break}v.setLineDash([]),v.translate(-.5,-.5)}g.selectStart!==null&&(v.translate(.5,.5),v.lineWidth=1,v.strokeStyle="rgba(255,165,0,0.6)",v.fillStyle="rgba(255,165,0,0.1)",w=g.selectBounds,v.beginPath(),v.rect(Math.floor(w.min.x),Math.floor(w.min.y),Math.floor(w.max.x-w.min.x),Math.floor(w.max.y-w.min.y)),v.closePath(),v.stroke(),v.fill(),v.translate(-.5,-.5)),A.hasBounds&&v.setTransform(1,0,0,1,0,0)};var d=function(g,v){var M=g.engine,S=g.timing,E=S.historySize,A=M.timing.timestamp;S.delta=v-S.lastTime||i._goodDelta,S.lastTime=v,S.timestampElapsed=A-S.lastTimestamp||0,S.lastTimestamp=A,S.deltaHistory.unshift(S.delta),S.deltaHistory.length=Math.min(S.deltaHistory.length,E),S.engineDeltaHistory.unshift(M.timing.lastDelta),S.engineDeltaHistory.length=Math.min(S.engineDeltaHistory.length,E),S.timestampElapsedHistory.unshift(S.timestampElapsed),S.timestampElapsedHistory.length=Math.min(S.timestampElapsedHistory.length,E),S.engineUpdatesHistory.unshift(M.timing.lastUpdatesPerFrame),S.engineUpdatesHistory.length=Math.min(S.engineUpdatesHistory.length,E),S.engineElapsedHistory.unshift(M.timing.lastElapsed),S.engineElapsedHistory.length=Math.min(S.engineElapsedHistory.length,E),S.elapsedHistory.unshift(S.lastElapsed),S.elapsedHistory.length=Math.min(S.elapsedHistory.length,E)},m=function(g){for(var v=0,M=0;M<g.length;M+=1)v+=g[M];return v/g.length||0},x=function(g,v){var M=document.createElement("canvas");return M.width=g,M.height=v,M.oncontextmenu=function(){return!1},M.onselectstart=function(){return!1},M},y=function(g){var v=g.getContext("2d"),M=window.devicePixelRatio||1,S=v.webkitBackingStorePixelRatio||v.mozBackingStorePixelRatio||v.msBackingStorePixelRatio||v.oBackingStorePixelRatio||v.backingStorePixelRatio||1;return M/S},p=function(g,v){var M=g.textures[v];return M||(M=g.textures[v]=new Image,M.src=v,M)},_=function(g,v){var M=v;/(jpg|gif|png)$/.test(v)&&(M="url("+v+")"),g.canvas.style.background=M,g.canvas.style.backgroundSize="contain",g.currentBackground=v}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(5),s=t(17),o=t(0);(function(){i._maxFrameDelta=1e3/15,i._frameDeltaFallback=1e3/60,i._timeBufferMargin=1.5,i._elapsedNextEstimate=1,i._smoothingLowerBound=.1,i._smoothingUpperBound=.9,i.create=function(l){var u={delta:16.666666666666668,frameDelta:null,frameDeltaSmoothing:!0,frameDeltaSnapping:!0,frameDeltaHistory:[],frameDeltaHistorySize:100,frameRequestId:null,timeBuffer:0,timeLastTick:null,maxUpdates:null,maxFrameTime:33.333333333333336,lastUpdatesDeferred:0,enabled:!0},h=o.extend(u,l);return h.fps=0,h},i.run=function(l,u){return l.timeBuffer=i._frameDeltaFallback,(function h(c){l.frameRequestId=i._onNextFrame(l,h),c&&l.enabled&&i.tick(l,u,c)})(),l},i.tick=function(l,u,h){var c=o.now(),f=l.delta,d=0,m=h-l.timeLastTick;if((!m||!l.timeLastTick||m>Math.max(i._maxFrameDelta,l.maxFrameTime))&&(m=l.frameDelta||i._frameDeltaFallback),l.frameDeltaSmoothing){l.frameDeltaHistory.push(m),l.frameDeltaHistory=l.frameDeltaHistory.slice(-l.frameDeltaHistorySize);var x=l.frameDeltaHistory.slice(0).sort(),y=l.frameDeltaHistory.slice(x.length*i._smoothingLowerBound,x.length*i._smoothingUpperBound),p=a(y);m=p||m}l.frameDeltaSnapping&&(m=1e3/Math.round(1e3/m)),l.frameDelta=m,l.timeLastTick=h,l.timeBuffer+=l.frameDelta,l.timeBuffer=o.clamp(l.timeBuffer,0,l.frameDelta+f*i._timeBufferMargin),l.lastUpdatesDeferred=0;var _=l.maxUpdates||Math.ceil(l.maxFrameTime/f),g={timestamp:u.timing.timestamp};r.trigger(l,"beforeTick",g),r.trigger(l,"tick",g);for(var v=o.now();f>0&&l.timeBuffer>=f*i._timeBufferMargin;){r.trigger(l,"beforeUpdate",g),s.update(u,f),r.trigger(l,"afterUpdate",g),l.timeBuffer-=f,d+=1;var M=o.now()-c,S=o.now()-v,E=M+i._elapsedNextEstimate*S/d;if(d>=_||E>l.maxFrameTime){l.lastUpdatesDeferred=Math.round(Math.max(0,l.timeBuffer/f-i._timeBufferMargin));break}}u.timing.lastUpdatesPerFrame=d,r.trigger(l,"afterTick",g),l.frameDeltaHistory.length>=100&&(l.lastUpdatesDeferred&&Math.round(l.frameDelta/f)>_?o.warnOnce("Matter.Runner: runner reached runner.maxUpdates, see docs."):l.lastUpdatesDeferred&&o.warnOnce("Matter.Runner: runner reached runner.maxFrameTime, see docs."),typeof l.isFixed<"u"&&o.warnOnce("Matter.Runner: runner.isFixed is now redundant, see docs."),(l.deltaMin||l.deltaMax)&&o.warnOnce("Matter.Runner: runner.deltaMin and runner.deltaMax were removed, see docs."),l.fps!==0&&o.warnOnce("Matter.Runner: runner.fps was replaced by runner.delta, see docs."))},i.stop=function(l){i._cancelNextFrame(l)},i._onNextFrame=function(l,u){if(typeof window<"u"&&window.requestAnimationFrame)l.frameRequestId=window.requestAnimationFrame(u);else throw new Error("Matter.Runner: missing required global window.requestAnimationFrame.");return l.frameRequestId},i._cancelNextFrame=function(l){if(typeof window<"u"&&window.cancelAnimationFrame)window.cancelAnimationFrame(l.frameRequestId);else throw new Error("Matter.Runner: missing required global window.cancelAnimationFrame.")};var a=function(l){for(var u=0,h=l.length,c=0;c<h;c+=1)u+=l[c];return u/h||0}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(8),s=t(0),o=s.deprecated;(function(){i.collides=function(a,l){return r.collides(a,l)},o(i,"collides","SAT.collides \u27A4 replaced by Collision.collides")})()}),(function(n,e,t){var i={};n.exports=i;var r=t(1),s=t(0);(function(){i.pathToVertices=function(o,a){typeof window<"u"&&!("SVGPathSeg"in window)&&s.warn("Svg.pathToVertices: SVGPathSeg not defined, a polyfill is required.");var l,u,h,c,f,d,m,x,y,p,_=[],g,v,M=0,S=0,E=0;a=a||15;var A=function(T,b,L){var D=L%2===1&&L>1;if(!y||T!=y.x||b!=y.y){y&&D?(g=y.x,v=y.y):(g=0,v=0);var F={x:g+T,y:v+b};(D||!y)&&(y=F),_.push(F),S=g+T,E=v+b}},w=function(T){var b=T.pathSegTypeAsLetter.toUpperCase();if(b!=="Z"){switch(b){case"M":case"L":case"T":case"C":case"S":case"Q":S=T.x,E=T.y;break;case"H":S=T.x;break;case"V":E=T.y;break}A(S,E,T.pathSegType)}};for(i._svgPathToAbsolute(o),h=o.getTotalLength(),d=[],l=0;l<o.pathSegList.numberOfItems;l+=1)d.push(o.pathSegList.getItem(l));for(m=d.concat();M<h;){if(p=o.getPathSegAtLength(M),f=d[p],f!=x){for(;m.length&&m[0]!=f;)w(m.shift());x=f}switch(f.pathSegTypeAsLetter.toUpperCase()){case"C":case"T":case"S":case"Q":case"A":c=o.getPointAtLength(M),A(c.x,c.y,0);break}M+=a}for(l=0,u=m.length;l<u;++l)w(m[l]);return _},i._svgPathToAbsolute=function(o){for(var a,l,u,h,c,f,d=o.pathSegList,m=0,x=0,y=d.numberOfItems,p=0;p<y;++p){var _=d.getItem(p),g=_.pathSegTypeAsLetter;if(/[MLHVCSQTA]/.test(g))"x"in _&&(m=_.x),"y"in _&&(x=_.y);else switch("x1"in _&&(u=m+_.x1),"x2"in _&&(c=m+_.x2),"y1"in _&&(h=x+_.y1),"y2"in _&&(f=x+_.y2),"x"in _&&(m+=_.x),"y"in _&&(x+=_.y),g){case"m":d.replaceItem(o.createSVGPathSegMovetoAbs(m,x),p);break;case"l":d.replaceItem(o.createSVGPathSegLinetoAbs(m,x),p);break;case"h":d.replaceItem(o.createSVGPathSegLinetoHorizontalAbs(m),p);break;case"v":d.replaceItem(o.createSVGPathSegLinetoVerticalAbs(x),p);break;case"c":d.replaceItem(o.createSVGPathSegCurvetoCubicAbs(m,x,u,h,c,f),p);break;case"s":d.replaceItem(o.createSVGPathSegCurvetoCubicSmoothAbs(m,x,c,f),p);break;case"q":d.replaceItem(o.createSVGPathSegCurvetoQuadraticAbs(m,x,u,h),p);break;case"t":d.replaceItem(o.createSVGPathSegCurvetoQuadraticSmoothAbs(m,x),p);break;case"a":d.replaceItem(o.createSVGPathSegArcAbs(m,x,_.r1,_.r2,_.angle,_.largeArcFlag,_.sweepFlag),p);break;case"z":case"Z":m=a,x=l;break}(g=="M"||g=="m")&&(a=m,l=x)}}})()}),(function(n,e,t){var i={};n.exports=i;var r=t(6),s=t(0);(function(){i.create=r.create,i.add=r.add,i.remove=r.remove,i.clear=r.clear,i.addComposite=r.addComposite,i.addBody=r.addBody,i.addConstraint=r.addConstraint})()})])})});var Ne=Th(Ih()),o_=Th(sx()),Kt=Th(ox());var Dx=0,Dp=1,Nx=2;var Np=1,Eu=2,fi=3,Ni=0,sn=1,di=2,Bi=0,Xr=1,Up=2,Fp=3,Op=4,Ux=5,vr=100,Fx=101,Ox=102,Bx=103,kx=104,zx=200,Vx=201,Hx=202,Gx=203,Zc=204,Jc=205,Wx=206,Xx=207,Yx=208,qx=209,$x=210,Zx=211,Jx=212,Kx=213,Qx=214,Tu=0,Au=1,bu=2,Yr=3,Cu=4,Ru=5,Pu=6,Iu=7,Bp=0,jx=1,ey=2,ki=0,ty=1,ny=2,iy=3,ry=4,sy=5,oy=6,ay=7;var kp=300,es=301,ts=302,Lu=303,Du=304,Ja=306,Kc=1e3,gr=1001,Qc=1002,kn=1003,ly=1004;var Ka=1005;var jn=1006,Nu=1007;var Sr=1008;var ii=1009,zp=1010,Vp=1011,co=1012,Uu=1013,Mr=1014,pi=1015,uo=1016,Fu=1017,Ou=1018,ho=1020,Hp=35902,Gp=35899,Wp=1021,Xp=1022,zn=1023,Qs=1026,fo=1027,Yp=1028,Bu=1029,qp=1030,ku=1031;var zu=1033,Qa=33776,ja=33777,el=33778,tl=33779,Vu=35840,Hu=35841,Gu=35842,Wu=35843,Xu=36196,Yu=37492,qu=37496,$u=37808,Zu=37809,Ju=37810,Ku=37811,Qu=37812,ju=37813,eh=37814,th=37815,nh=37816,ih=37817,rh=37818,sh=37819,oh=37820,ah=37821,lh=36492,ch=36494,uh=36495,hh=36283,fh=36284,dh=36285,ph=36286;var Sa=2300,jc=2301,$c=2302,Sp=2400,Mp=2401,wp=2402;var cy=3200,uy=3201;var $p=0,hy=1,zi="",qt="srgb",qr="srgb-linear",Ma="linear",st="srgb";var Wr=7680;var Ep=519,fy=512,dy=513,py=514,Zp=515,my=516,gy=517,vy=518,xy=519,Tp=35044;var Jp="300 es",Qn=2e3,wa=2001;var Ui=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let i=this._listeners;i[e]===void 0&&(i[e]=[]),i[e].indexOf(t)===-1&&i[e].push(t)}hasEventListener(e,t){let i=this._listeners;return i===void 0?!1:i[e]!==void 0&&i[e].indexOf(t)!==-1}removeEventListener(e,t){let i=this._listeners;if(i===void 0)return;let r=i[e];if(r!==void 0){let s=r.indexOf(t);s!==-1&&r.splice(s,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let i=t[e.type];if(i!==void 0){e.target=this;let r=i.slice(0);for(let s=0,o=r.length;s<o;s++)r[s].call(this,e);e.target=null}}},Xt=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];var $d=Math.PI/180,eu=180/Math.PI;function po(){let n=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(Xt[n&255]+Xt[n>>8&255]+Xt[n>>16&255]+Xt[n>>24&255]+"-"+Xt[e&255]+Xt[e>>8&255]+"-"+Xt[e>>16&15|64]+Xt[e>>24&255]+"-"+Xt[t&63|128]+Xt[t>>8&255]+"-"+Xt[t>>16&255]+Xt[t>>24&255]+Xt[i&255]+Xt[i>>8&255]+Xt[i>>16&255]+Xt[i>>24&255]).toLowerCase()}function Ke(n,e,t){return Math.max(e,Math.min(t,n))}function BM(n,e){return(n%e+e)%e}function Zd(n,e,t){return(1-t)*n+t*e}function da(n,e){switch(e.constructor){case Float32Array:return n;case Uint32Array:return n/4294967295;case Uint16Array:return n/65535;case Uint8Array:return n/255;case Int32Array:return Math.max(n/2147483647,-1);case Int16Array:return Math.max(n/32767,-1);case Int8Array:return Math.max(n/127,-1);default:throw new Error("Invalid component type.")}}function fn(n,e){switch(e.constructor){case Float32Array:return n;case Uint32Array:return Math.round(n*4294967295);case Uint16Array:return Math.round(n*65535);case Uint8Array:return Math.round(n*255);case Int32Array:return Math.round(n*2147483647);case Int16Array:return Math.round(n*32767);case Int8Array:return Math.round(n*127);default:throw new Error("Invalid component type.")}}var Se=class n{constructor(e=0,t=0){n.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,i=this.y,r=e.elements;return this.x=r[0]*t+r[3]*i+r[6],this.y=r[1]*t+r[4]*i+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Ke(this.x,e.x,t.x),this.y=Ke(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=Ke(this.x,e,t),this.y=Ke(this.y,e,t),this}clampLength(e,t){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ke(i,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let i=this.dot(e)/t;return Math.acos(Ke(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,i=this.y-e.y;return t*t+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,i){return this.x=e.x+(t.x-e.x)*i,this.y=e.y+(t.y-e.y)*i,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let i=Math.cos(t),r=Math.sin(t),s=this.x-e.x,o=this.y-e.y;return this.x=s*i-o*r+e.x,this.y=s*r+o*i+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},Fi=class{constructor(e=0,t=0,i=0,r=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=i,this._w=r}static slerpFlat(e,t,i,r,s,o,a){let l=i[r+0],u=i[r+1],h=i[r+2],c=i[r+3],f=s[o+0],d=s[o+1],m=s[o+2],x=s[o+3];if(a===0){e[t+0]=l,e[t+1]=u,e[t+2]=h,e[t+3]=c;return}if(a===1){e[t+0]=f,e[t+1]=d,e[t+2]=m,e[t+3]=x;return}if(c!==x||l!==f||u!==d||h!==m){let y=1-a,p=l*f+u*d+h*m+c*x,_=p>=0?1:-1,g=1-p*p;if(g>Number.EPSILON){let M=Math.sqrt(g),S=Math.atan2(M,p*_);y=Math.sin(y*S)/M,a=Math.sin(a*S)/M}let v=a*_;if(l=l*y+f*v,u=u*y+d*v,h=h*y+m*v,c=c*y+x*v,y===1-a){let M=1/Math.sqrt(l*l+u*u+h*h+c*c);l*=M,u*=M,h*=M,c*=M}}e[t]=l,e[t+1]=u,e[t+2]=h,e[t+3]=c}static multiplyQuaternionsFlat(e,t,i,r,s,o){let a=i[r],l=i[r+1],u=i[r+2],h=i[r+3],c=s[o],f=s[o+1],d=s[o+2],m=s[o+3];return e[t]=a*m+h*c+l*d-u*f,e[t+1]=l*m+h*f+u*c-a*d,e[t+2]=u*m+h*d+a*f-l*c,e[t+3]=h*m-a*c-l*f-u*d,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,i,r){return this._x=e,this._y=t,this._z=i,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let i=e._x,r=e._y,s=e._z,o=e._order,a=Math.cos,l=Math.sin,u=a(i/2),h=a(r/2),c=a(s/2),f=l(i/2),d=l(r/2),m=l(s/2);switch(o){case"XYZ":this._x=f*h*c+u*d*m,this._y=u*d*c-f*h*m,this._z=u*h*m+f*d*c,this._w=u*h*c-f*d*m;break;case"YXZ":this._x=f*h*c+u*d*m,this._y=u*d*c-f*h*m,this._z=u*h*m-f*d*c,this._w=u*h*c+f*d*m;break;case"ZXY":this._x=f*h*c-u*d*m,this._y=u*d*c+f*h*m,this._z=u*h*m+f*d*c,this._w=u*h*c-f*d*m;break;case"ZYX":this._x=f*h*c-u*d*m,this._y=u*d*c+f*h*m,this._z=u*h*m-f*d*c,this._w=u*h*c+f*d*m;break;case"YZX":this._x=f*h*c+u*d*m,this._y=u*d*c+f*h*m,this._z=u*h*m-f*d*c,this._w=u*h*c-f*d*m;break;case"XZY":this._x=f*h*c-u*d*m,this._y=u*d*c-f*h*m,this._z=u*h*m+f*d*c,this._w=u*h*c+f*d*m;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let i=t/2,r=Math.sin(i);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,i=t[0],r=t[4],s=t[8],o=t[1],a=t[5],l=t[9],u=t[2],h=t[6],c=t[10],f=i+a+c;if(f>0){let d=.5/Math.sqrt(f+1);this._w=.25/d,this._x=(h-l)*d,this._y=(s-u)*d,this._z=(o-r)*d}else if(i>a&&i>c){let d=2*Math.sqrt(1+i-a-c);this._w=(h-l)/d,this._x=.25*d,this._y=(r+o)/d,this._z=(s+u)/d}else if(a>c){let d=2*Math.sqrt(1+a-i-c);this._w=(s-u)/d,this._x=(r+o)/d,this._y=.25*d,this._z=(l+h)/d}else{let d=2*Math.sqrt(1+c-i-a);this._w=(o-r)/d,this._x=(s+u)/d,this._y=(l+h)/d,this._z=.25*d}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let i=e.dot(t)+1;return i<1e-8?(i=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=i):(this._x=0,this._y=-e.z,this._z=e.y,this._w=i)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=i),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Ke(this.dot(e),-1,1)))}rotateTowards(e,t){let i=this.angleTo(e);if(i===0)return this;let r=Math.min(1,t/i);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let i=e._x,r=e._y,s=e._z,o=e._w,a=t._x,l=t._y,u=t._z,h=t._w;return this._x=i*h+o*a+r*u-s*l,this._y=r*h+o*l+s*a-i*u,this._z=s*h+o*u+i*l-r*a,this._w=o*h-i*a-r*l-s*u,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);let i=this._x,r=this._y,s=this._z,o=this._w,a=o*e._w+i*e._x+r*e._y+s*e._z;if(a<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,a=-a):this.copy(e),a>=1)return this._w=o,this._x=i,this._y=r,this._z=s,this;let l=1-a*a;if(l<=Number.EPSILON){let d=1-t;return this._w=d*o+t*this._w,this._x=d*i+t*this._x,this._y=d*r+t*this._y,this._z=d*s+t*this._z,this.normalize(),this}let u=Math.sqrt(l),h=Math.atan2(u,a),c=Math.sin((1-t)*h)/u,f=Math.sin(t*h)/u;return this._w=o*c+this._w*f,this._x=i*c+this._x*f,this._y=r*c+this._y*f,this._z=s*c+this._z*f,this._onChangeCallback(),this}slerpQuaternions(e,t,i){return this.copy(e).slerp(t,i)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),i=Math.random(),r=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(r*Math.sin(e),r*Math.cos(e),s*Math.sin(t),s*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},V=class n{constructor(e=0,t=0,i=0){n.prototype.isVector3=!0,this.x=e,this.y=t,this.z=i}set(e,t,i){return i===void 0&&(i=this.z),this.x=e,this.y=t,this.z=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(ax.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(ax.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*t+s[3]*i+s[6]*r,this.y=s[1]*t+s[4]*i+s[7]*r,this.z=s[2]*t+s[5]*i+s[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,i=this.y,r=this.z,s=e.elements,o=1/(s[3]*t+s[7]*i+s[11]*r+s[15]);return this.x=(s[0]*t+s[4]*i+s[8]*r+s[12])*o,this.y=(s[1]*t+s[5]*i+s[9]*r+s[13])*o,this.z=(s[2]*t+s[6]*i+s[10]*r+s[14])*o,this}applyQuaternion(e){let t=this.x,i=this.y,r=this.z,s=e.x,o=e.y,a=e.z,l=e.w,u=2*(o*r-a*i),h=2*(a*t-s*r),c=2*(s*i-o*t);return this.x=t+l*u+o*c-a*h,this.y=i+l*h+a*u-s*c,this.z=r+l*c+s*h-o*u,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,i=this.y,r=this.z,s=e.elements;return this.x=s[0]*t+s[4]*i+s[8]*r,this.y=s[1]*t+s[5]*i+s[9]*r,this.z=s[2]*t+s[6]*i+s[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Ke(this.x,e.x,t.x),this.y=Ke(this.y,e.y,t.y),this.z=Ke(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=Ke(this.x,e,t),this.y=Ke(this.y,e,t),this.z=Ke(this.z,e,t),this}clampLength(e,t){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ke(i,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,i){return this.x=e.x+(t.x-e.x)*i,this.y=e.y+(t.y-e.y)*i,this.z=e.z+(t.z-e.z)*i,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let i=e.x,r=e.y,s=e.z,o=t.x,a=t.y,l=t.z;return this.x=r*l-s*a,this.y=s*o-i*l,this.z=i*a-r*o,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let i=e.dot(this)/t;return this.copy(e).multiplyScalar(i)}projectOnPlane(e){return Jd.copy(this).projectOnVector(e),this.sub(Jd)}reflect(e){return this.sub(Jd.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let i=this.dot(e)/t;return Math.acos(Ke(i,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,i=this.y-e.y,r=this.z-e.z;return t*t+i*i+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,i){let r=Math.sin(t)*e;return this.x=r*Math.sin(i),this.y=Math.cos(t)*e,this.z=r*Math.cos(i),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,i){return this.x=e*Math.sin(t),this.y=i,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),i=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=i,this.z=r,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,i=Math.sqrt(1-t*t);return this.x=i*Math.cos(e),this.y=t,this.z=i*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},Jd=new V,ax=new Fi,$e=class n{constructor(e,t,i,r,s,o,a,l,u){n.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,i,r,s,o,a,l,u)}set(e,t,i,r,s,o,a,l,u){let h=this.elements;return h[0]=e,h[1]=r,h[2]=a,h[3]=t,h[4]=s,h[5]=l,h[6]=i,h[7]=o,h[8]=u,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,i=e.elements;return t[0]=i[0],t[1]=i[1],t[2]=i[2],t[3]=i[3],t[4]=i[4],t[5]=i[5],t[6]=i[6],t[7]=i[7],t[8]=i[8],this}extractBasis(e,t,i){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let i=e.elements,r=t.elements,s=this.elements,o=i[0],a=i[3],l=i[6],u=i[1],h=i[4],c=i[7],f=i[2],d=i[5],m=i[8],x=r[0],y=r[3],p=r[6],_=r[1],g=r[4],v=r[7],M=r[2],S=r[5],E=r[8];return s[0]=o*x+a*_+l*M,s[3]=o*y+a*g+l*S,s[6]=o*p+a*v+l*E,s[1]=u*x+h*_+c*M,s[4]=u*y+h*g+c*S,s[7]=u*p+h*v+c*E,s[2]=f*x+d*_+m*M,s[5]=f*y+d*g+m*S,s[8]=f*p+d*v+m*E,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],u=e[7],h=e[8];return t*o*h-t*a*u-i*s*h+i*a*l+r*s*u-r*o*l}invert(){let e=this.elements,t=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],u=e[7],h=e[8],c=h*o-a*u,f=a*l-h*s,d=u*s-o*l,m=t*c+i*f+r*d;if(m===0)return this.set(0,0,0,0,0,0,0,0,0);let x=1/m;return e[0]=c*x,e[1]=(r*u-h*i)*x,e[2]=(a*i-r*o)*x,e[3]=f*x,e[4]=(h*t-r*l)*x,e[5]=(r*s-a*t)*x,e[6]=d*x,e[7]=(i*l-u*t)*x,e[8]=(o*t-i*s)*x,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,i,r,s,o,a){let l=Math.cos(s),u=Math.sin(s);return this.set(i*l,i*u,-i*(l*o+u*a)+o+e,-r*u,r*l,-r*(-u*o+l*a)+a+t,0,0,1),this}scale(e,t){return this.premultiply(Kd.makeScale(e,t)),this}rotate(e){return this.premultiply(Kd.makeRotation(-e)),this}translate(e,t){return this.premultiply(Kd.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),i=Math.sin(e);return this.set(t,-i,0,i,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,i=e.elements;for(let r=0;r<9;r++)if(t[r]!==i[r])return!1;return!0}fromArray(e,t=0){for(let i=0;i<9;i++)this.elements[i]=e[i+t];return this}toArray(e=[],t=0){let i=this.elements;return e[t]=i[0],e[t+1]=i[1],e[t+2]=i[2],e[t+3]=i[3],e[t+4]=i[4],e[t+5]=i[5],e[t+6]=i[6],e[t+7]=i[7],e[t+8]=i[8],e}clone(){return new this.constructor().fromArray(this.elements)}},Kd=new $e;function Kp(n){for(let e=n.length-1;e>=0;--e)if(n[e]>=65535)return!0;return!1}function Ea(n){return document.createElementNS("http://www.w3.org/1999/xhtml",n)}function yy(){let n=Ea("canvas");return n.style.display="block",n}var lx={};function js(n){n in lx||(lx[n]=!0,console.warn(n))}function _y(n,e,t){return new Promise(function(i,r){function s(){switch(n.clientWaitSync(e,n.SYNC_FLUSH_COMMANDS_BIT,0)){case n.WAIT_FAILED:r();break;case n.TIMEOUT_EXPIRED:setTimeout(s,t);break;default:i()}}setTimeout(s,t)})}var cx=new $e().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),ux=new $e().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function kM(){let n={enabled:!0,workingColorSpace:qr,spaces:{},convert:function(r,s,o){return this.enabled===!1||s===o||!s||!o||(this.spaces[s].transfer===st&&(r.r=Di(r.r),r.g=Di(r.g),r.b=Di(r.b)),this.spaces[s].primaries!==this.spaces[o].primaries&&(r.applyMatrix3(this.spaces[s].toXYZ),r.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===st&&(r.r=Js(r.r),r.g=Js(r.g),r.b=Js(r.b))),r},workingToColorSpace:function(r,s){return this.convert(r,this.workingColorSpace,s)},colorSpaceToWorking:function(r,s){return this.convert(r,s,this.workingColorSpace)},getPrimaries:function(r){return this.spaces[r].primaries},getTransfer:function(r){return r===zi?Ma:this.spaces[r].transfer},getToneMappingMode:function(r){return this.spaces[r].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(r,s=this.workingColorSpace){return r.fromArray(this.spaces[s].luminanceCoefficients)},define:function(r){Object.assign(this.spaces,r)},_getMatrix:function(r,s,o){return r.copy(this.spaces[s].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(r){return this.spaces[r].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(r=this.workingColorSpace){return this.spaces[r].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(r,s){return js("THREE.ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),n.workingToColorSpace(r,s)},toWorkingColorSpace:function(r,s){return js("THREE.ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),n.colorSpaceToWorking(r,s)}},e=[.64,.33,.3,.6,.15,.06],t=[.2126,.7152,.0722],i=[.3127,.329];return n.define({[qr]:{primaries:e,whitePoint:i,transfer:Ma,toXYZ:cx,fromXYZ:ux,luminanceCoefficients:t,workingColorSpaceConfig:{unpackColorSpace:qt},outputColorSpaceConfig:{drawingBufferColorSpace:qt}},[qt]:{primaries:e,whitePoint:i,transfer:st,toXYZ:cx,fromXYZ:ux,luminanceCoefficients:t,outputColorSpaceConfig:{drawingBufferColorSpace:qt}}}),n}var tt=kM();function Di(n){return n<.04045?n*.0773993808:Math.pow(n*.9478672986+.0521327014,2.4)}function Js(n){return n<.0031308?n*12.92:1.055*Math.pow(n,.41666)-.055}var Bs,tu=class{static getDataURL(e,t="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let i;if(e instanceof HTMLCanvasElement)i=e;else{Bs===void 0&&(Bs=Ea("canvas")),Bs.width=e.width,Bs.height=e.height;let r=Bs.getContext("2d");e instanceof ImageData?r.putImageData(e,0,0):r.drawImage(e,0,0,e.width,e.height),i=Bs}return i.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let t=Ea("canvas");t.width=e.width,t.height=e.height;let i=t.getContext("2d");i.drawImage(e,0,0,e.width,e.height);let r=i.getImageData(0,0,e.width,e.height),s=r.data;for(let o=0;o<s.length;o++)s[o]=Di(s[o]/255)*255;return i.putImageData(r,0,0),t}else if(e.data){let t=e.data.slice(0);for(let i=0;i<t.length;i++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[i]=Math.floor(Di(t[i]/255)*255):t[i]=Di(t[i]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},zM=0,eo=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:zM++}),this.uuid=po(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let t=this.data;return typeof HTMLVideoElement<"u"&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):t instanceof VideoFrame?e.set(t.displayHeight,t.displayWidth,0):t!==null?e.set(t.width,t.height,t.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let i={uuid:this.uuid,url:""},r=this.data;if(r!==null){let s;if(Array.isArray(r)){s=[];for(let o=0,a=r.length;o<a;o++)r[o].isDataTexture?s.push(Qd(r[o].image)):s.push(Qd(r[o]))}else s=Qd(r);i.url=s}return t||(e.images[this.uuid]=i),i}};function Qd(n){return typeof HTMLImageElement<"u"&&n instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&n instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&n instanceof ImageBitmap?tu.getDataURL(n):n.data?{data:Array.from(n.data),width:n.width,height:n.height,type:n.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}var VM=0,jd=new V,pn=class n extends Ui{constructor(e=n.DEFAULT_IMAGE,t=n.DEFAULT_MAPPING,i=gr,r=gr,s=jn,o=Sr,a=zn,l=ii,u=n.DEFAULT_ANISOTROPY,h=zi){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:VM++}),this.uuid=po(),this.name="",this.source=new eo(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=i,this.wrapT=r,this.magFilter=s,this.minFilter=o,this.anisotropy=u,this.format=a,this.internalFormat=null,this.type=l,this.offset=new Se(0,0),this.repeat=new Se(1,1),this.center=new Se(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new $e,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0}get width(){return this.source.getSize(jd).x}get height(){return this.source.getSize(jd).y}get depth(){return this.source.getSize(jd).z}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let t in e){let i=e[t];if(i===void 0){console.warn(`THREE.Texture.setValues(): parameter '${t}' has value of undefined.`);continue}let r=this[t];if(r===void 0){console.warn(`THREE.Texture.setValues(): property '${t}' does not exist.`);continue}r&&i&&r.isVector2&&i.isVector2||r&&i&&r.isVector3&&i.isVector3||r&&i&&r.isMatrix3&&i.isMatrix3?r.copy(i):this[t]=i}}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),t||(e.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==kp)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Kc:e.x=e.x-Math.floor(e.x);break;case gr:e.x=e.x<0?0:1;break;case Qc:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Kc:e.y=e.y-Math.floor(e.y);break;case gr:e.y=e.y<0?0:1;break;case Qc:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};pn.DEFAULT_IMAGE=null;pn.DEFAULT_MAPPING=kp;pn.DEFAULT_ANISOTROPY=1;var wt=class n{constructor(e=0,t=0,i=0,r=1){n.prototype.isVector4=!0,this.x=e,this.y=t,this.z=i,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,i,r){return this.x=e,this.y=t,this.z=i,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,i=this.y,r=this.z,s=this.w,o=e.elements;return this.x=o[0]*t+o[4]*i+o[8]*r+o[12]*s,this.y=o[1]*t+o[5]*i+o[9]*r+o[13]*s,this.z=o[2]*t+o[6]*i+o[10]*r+o[14]*s,this.w=o[3]*t+o[7]*i+o[11]*r+o[15]*s,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,i,r,s,l=e.elements,u=l[0],h=l[4],c=l[8],f=l[1],d=l[5],m=l[9],x=l[2],y=l[6],p=l[10];if(Math.abs(h-f)<.01&&Math.abs(c-x)<.01&&Math.abs(m-y)<.01){if(Math.abs(h+f)<.1&&Math.abs(c+x)<.1&&Math.abs(m+y)<.1&&Math.abs(u+d+p-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;let g=(u+1)/2,v=(d+1)/2,M=(p+1)/2,S=(h+f)/4,E=(c+x)/4,A=(m+y)/4;return g>v&&g>M?g<.01?(i=0,r=.707106781,s=.707106781):(i=Math.sqrt(g),r=S/i,s=E/i):v>M?v<.01?(i=.707106781,r=0,s=.707106781):(r=Math.sqrt(v),i=S/r,s=A/r):M<.01?(i=.707106781,r=.707106781,s=0):(s=Math.sqrt(M),i=E/s,r=A/s),this.set(i,r,s,t),this}let _=Math.sqrt((y-m)*(y-m)+(c-x)*(c-x)+(f-h)*(f-h));return Math.abs(_)<.001&&(_=1),this.x=(y-m)/_,this.y=(c-x)/_,this.z=(f-h)/_,this.w=Math.acos((u+d+p-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Ke(this.x,e.x,t.x),this.y=Ke(this.y,e.y,t.y),this.z=Ke(this.z,e.z,t.z),this.w=Ke(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=Ke(this.x,e,t),this.y=Ke(this.y,e,t),this.z=Ke(this.z,e,t),this.w=Ke(this.w,e,t),this}clampLength(e,t){let i=this.length();return this.divideScalar(i||1).multiplyScalar(Ke(i,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,i){return this.x=e.x+(t.x-e.x)*i,this.y=e.y+(t.y-e.y)*i,this.z=e.z+(t.z-e.z)*i,this.w=e.w+(t.w-e.w)*i,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},nu=class extends Ui{constructor(e=1,t=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:jn,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},i),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=i.depth,this.scissor=new wt(0,0,e,t),this.scissorTest=!1,this.viewport=new wt(0,0,e,t);let r={width:e,height:t,depth:i.depth},s=new pn(r);this.textures=[];let o=i.count;for(let a=0;a<o;a++)this.textures[a]=s.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview}_setTextureOptions(e={}){let t={minFilter:jn,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(t.mapping=e.mapping),e.wrapS!==void 0&&(t.wrapS=e.wrapS),e.wrapT!==void 0&&(t.wrapT=e.wrapT),e.wrapR!==void 0&&(t.wrapR=e.wrapR),e.magFilter!==void 0&&(t.magFilter=e.magFilter),e.minFilter!==void 0&&(t.minFilter=e.minFilter),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.anisotropy!==void 0&&(t.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(t.internalFormat=e.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(t)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,i=1){if(this.width!==e||this.height!==t||this.depth!==i){this.width=e,this.height=t,this.depth=i;for(let r=0,s=this.textures.length;r<s;r++)this.textures[r].image.width=e,this.textures[r].image.height=t,this.textures[r].image.depth=i,this.textures[r].isArrayTexture=this.textures[r].image.depth>1;this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,i=e.textures.length;t<i;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;let r=Object.assign({},e.textures[t].image);this.textures[t].source=new eo(r)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}},hi=class extends nu{constructor(e=1,t=1,i={}){super(e,t,i),this.isWebGLRenderTarget=!0}},Ta=class extends pn{constructor(e=null,t=1,i=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:i,depth:r},this.magFilter=kn,this.minFilter=kn,this.wrapR=gr,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var iu=class extends pn{constructor(e=null,t=1,i=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:i,depth:r},this.magFilter=kn,this.minFilter=kn,this.wrapR=gr,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var xr=class{constructor(e=new V(1/0,1/0,1/0),t=new V(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,i=e.length;t<i;t+=3)this.expandByPoint(Zn.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,i=e.count;t<i;t++)this.expandByPoint(Zn.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,i=e.length;t<i;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let i=Zn.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(i),this.max.copy(e).add(i),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let i=e.geometry;if(i!==void 0){let s=i.getAttribute("position");if(t===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=s.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,Zn):Zn.fromBufferAttribute(s,o),Zn.applyMatrix4(e.matrixWorld),this.expandByPoint(Zn);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),bc.copy(e.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),bc.copy(i.boundingBox)),bc.applyMatrix4(e.matrixWorld),this.union(bc)}let r=e.children;for(let s=0,o=r.length;s<o;s++)this.expandByObject(r[s],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,Zn),Zn.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,i;return e.normal.x>0?(t=e.normal.x*this.min.x,i=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,i=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,i+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,i+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,i+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,i+=e.normal.z*this.min.z),t<=-e.constant&&i>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(pa),Cc.subVectors(this.max,pa),ks.subVectors(e.a,pa),zs.subVectors(e.b,pa),Vs.subVectors(e.c,pa),cr.subVectors(zs,ks),ur.subVectors(Vs,zs),zr.subVectors(ks,Vs);let t=[0,-cr.z,cr.y,0,-ur.z,ur.y,0,-zr.z,zr.y,cr.z,0,-cr.x,ur.z,0,-ur.x,zr.z,0,-zr.x,-cr.y,cr.x,0,-ur.y,ur.x,0,-zr.y,zr.x,0];return!ep(t,ks,zs,Vs,Cc)||(t=[1,0,0,0,1,0,0,0,1],!ep(t,ks,zs,Vs,Cc))?!1:(Rc.crossVectors(cr,ur),t=[Rc.x,Rc.y,Rc.z],ep(t,ks,zs,Vs,Cc))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,Zn).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(Zn).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(bi[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),bi[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),bi[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),bi[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),bi[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),bi[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),bi[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),bi[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(bi),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},bi=[new V,new V,new V,new V,new V,new V,new V,new V],Zn=new V,bc=new xr,ks=new V,zs=new V,Vs=new V,cr=new V,ur=new V,zr=new V,pa=new V,Cc=new V,Rc=new V,Vr=new V;function ep(n,e,t,i,r){for(let s=0,o=n.length-3;s<=o;s+=3){Vr.fromArray(n,s);let a=r.x*Math.abs(Vr.x)+r.y*Math.abs(Vr.y)+r.z*Math.abs(Vr.z),l=e.dot(Vr),u=t.dot(Vr),h=i.dot(Vr);if(Math.max(-Math.max(l,u,h),Math.min(l,u,h))>a)return!1}return!0}var HM=new xr,ma=new V,tp=new V,to=class{constructor(e=new V,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let i=this.center;t!==void 0?i.copy(t):HM.setFromPoints(e).getCenter(i);let r=0;for(let s=0,o=e.length;s<o;s++)r=Math.max(r,i.distanceToSquared(e[s]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let i=this.center.distanceToSquared(e);return t.copy(e),i>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;ma.subVectors(e,this.center);let t=ma.lengthSq();if(t>this.radius*this.radius){let i=Math.sqrt(t),r=(i-this.radius)*.5;this.center.addScaledVector(ma,r/i),this.radius+=r}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(tp.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(ma.copy(e.center).add(tp)),this.expandByPoint(ma.copy(e.center).sub(tp))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},Ci=new V,np=new V,Pc=new V,hr=new V,ip=new V,Ic=new V,rp=new V,Aa=class{constructor(e=new V,t=new V(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,Ci)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let i=t.dot(this.direction);return i<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=Ci.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(Ci.copy(this.origin).addScaledVector(this.direction,t),Ci.distanceToSquared(e))}distanceSqToSegment(e,t,i,r){np.copy(e).add(t).multiplyScalar(.5),Pc.copy(t).sub(e).normalize(),hr.copy(this.origin).sub(np);let s=e.distanceTo(t)*.5,o=-this.direction.dot(Pc),a=hr.dot(this.direction),l=-hr.dot(Pc),u=hr.lengthSq(),h=Math.abs(1-o*o),c,f,d,m;if(h>0)if(c=o*l-a,f=o*a-l,m=s*h,c>=0)if(f>=-m)if(f<=m){let x=1/h;c*=x,f*=x,d=c*(c+o*f+2*a)+f*(o*c+f+2*l)+u}else f=s,c=Math.max(0,-(o*f+a)),d=-c*c+f*(f+2*l)+u;else f=-s,c=Math.max(0,-(o*f+a)),d=-c*c+f*(f+2*l)+u;else f<=-m?(c=Math.max(0,-(-o*s+a)),f=c>0?-s:Math.min(Math.max(-s,-l),s),d=-c*c+f*(f+2*l)+u):f<=m?(c=0,f=Math.min(Math.max(-s,-l),s),d=f*(f+2*l)+u):(c=Math.max(0,-(o*s+a)),f=c>0?s:Math.min(Math.max(-s,-l),s),d=-c*c+f*(f+2*l)+u);else f=o>0?-s:s,c=Math.max(0,-(o*f+a)),d=-c*c+f*(f+2*l)+u;return i&&i.copy(this.origin).addScaledVector(this.direction,c),r&&r.copy(np).addScaledVector(Pc,f),d}intersectSphere(e,t){Ci.subVectors(e.center,this.origin);let i=Ci.dot(this.direction),r=Ci.dot(Ci)-i*i,s=e.radius*e.radius;if(r>s)return null;let o=Math.sqrt(s-r),a=i-o,l=i+o;return l<0?null:a<0?this.at(l,t):this.at(a,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let i=-(this.origin.dot(e.normal)+e.constant)/t;return i>=0?i:null}intersectPlane(e,t){let i=this.distanceToPlane(e);return i===null?null:this.at(i,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let i,r,s,o,a,l,u=1/this.direction.x,h=1/this.direction.y,c=1/this.direction.z,f=this.origin;return u>=0?(i=(e.min.x-f.x)*u,r=(e.max.x-f.x)*u):(i=(e.max.x-f.x)*u,r=(e.min.x-f.x)*u),h>=0?(s=(e.min.y-f.y)*h,o=(e.max.y-f.y)*h):(s=(e.max.y-f.y)*h,o=(e.min.y-f.y)*h),i>o||s>r||((s>i||isNaN(i))&&(i=s),(o<r||isNaN(r))&&(r=o),c>=0?(a=(e.min.z-f.z)*c,l=(e.max.z-f.z)*c):(a=(e.max.z-f.z)*c,l=(e.min.z-f.z)*c),i>l||a>r)||((a>i||i!==i)&&(i=a),(l<r||r!==r)&&(r=l),r<0)?null:this.at(i>=0?i:r,t)}intersectsBox(e){return this.intersectBox(e,Ci)!==null}intersectTriangle(e,t,i,r,s){ip.subVectors(t,e),Ic.subVectors(i,e),rp.crossVectors(ip,Ic);let o=this.direction.dot(rp),a;if(o>0){if(r)return null;a=1}else if(o<0)a=-1,o=-o;else return null;hr.subVectors(this.origin,e);let l=a*this.direction.dot(Ic.crossVectors(hr,Ic));if(l<0)return null;let u=a*this.direction.dot(ip.cross(hr));if(u<0||l+u>o)return null;let h=-a*hr.dot(rp);return h<0?null:this.at(h/o,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},Mt=class n{constructor(e,t,i,r,s,o,a,l,u,h,c,f,d,m,x,y){n.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,i,r,s,o,a,l,u,h,c,f,d,m,x,y)}set(e,t,i,r,s,o,a,l,u,h,c,f,d,m,x,y){let p=this.elements;return p[0]=e,p[4]=t,p[8]=i,p[12]=r,p[1]=s,p[5]=o,p[9]=a,p[13]=l,p[2]=u,p[6]=h,p[10]=c,p[14]=f,p[3]=d,p[7]=m,p[11]=x,p[15]=y,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new n().fromArray(this.elements)}copy(e){let t=this.elements,i=e.elements;return t[0]=i[0],t[1]=i[1],t[2]=i[2],t[3]=i[3],t[4]=i[4],t[5]=i[5],t[6]=i[6],t[7]=i[7],t[8]=i[8],t[9]=i[9],t[10]=i[10],t[11]=i[11],t[12]=i[12],t[13]=i[13],t[14]=i[14],t[15]=i[15],this}copyPosition(e){let t=this.elements,i=e.elements;return t[12]=i[12],t[13]=i[13],t[14]=i[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,i){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this}makeBasis(e,t,i){return this.set(e.x,t.x,i.x,0,e.y,t.y,i.y,0,e.z,t.z,i.z,0,0,0,0,1),this}extractRotation(e){let t=this.elements,i=e.elements,r=1/Hs.setFromMatrixColumn(e,0).length(),s=1/Hs.setFromMatrixColumn(e,1).length(),o=1/Hs.setFromMatrixColumn(e,2).length();return t[0]=i[0]*r,t[1]=i[1]*r,t[2]=i[2]*r,t[3]=0,t[4]=i[4]*s,t[5]=i[5]*s,t[6]=i[6]*s,t[7]=0,t[8]=i[8]*o,t[9]=i[9]*o,t[10]=i[10]*o,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,i=e.x,r=e.y,s=e.z,o=Math.cos(i),a=Math.sin(i),l=Math.cos(r),u=Math.sin(r),h=Math.cos(s),c=Math.sin(s);if(e.order==="XYZ"){let f=o*h,d=o*c,m=a*h,x=a*c;t[0]=l*h,t[4]=-l*c,t[8]=u,t[1]=d+m*u,t[5]=f-x*u,t[9]=-a*l,t[2]=x-f*u,t[6]=m+d*u,t[10]=o*l}else if(e.order==="YXZ"){let f=l*h,d=l*c,m=u*h,x=u*c;t[0]=f+x*a,t[4]=m*a-d,t[8]=o*u,t[1]=o*c,t[5]=o*h,t[9]=-a,t[2]=d*a-m,t[6]=x+f*a,t[10]=o*l}else if(e.order==="ZXY"){let f=l*h,d=l*c,m=u*h,x=u*c;t[0]=f-x*a,t[4]=-o*c,t[8]=m+d*a,t[1]=d+m*a,t[5]=o*h,t[9]=x-f*a,t[2]=-o*u,t[6]=a,t[10]=o*l}else if(e.order==="ZYX"){let f=o*h,d=o*c,m=a*h,x=a*c;t[0]=l*h,t[4]=m*u-d,t[8]=f*u+x,t[1]=l*c,t[5]=x*u+f,t[9]=d*u-m,t[2]=-u,t[6]=a*l,t[10]=o*l}else if(e.order==="YZX"){let f=o*l,d=o*u,m=a*l,x=a*u;t[0]=l*h,t[4]=x-f*c,t[8]=m*c+d,t[1]=c,t[5]=o*h,t[9]=-a*h,t[2]=-u*h,t[6]=d*c+m,t[10]=f-x*c}else if(e.order==="XZY"){let f=o*l,d=o*u,m=a*l,x=a*u;t[0]=l*h,t[4]=-c,t[8]=u*h,t[1]=f*c+x,t[5]=o*h,t[9]=d*c-m,t[2]=m*c-d,t[6]=a*h,t[10]=x*c+f}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(GM,e,WM)}lookAt(e,t,i){let r=this.elements;return wn.subVectors(e,t),wn.lengthSq()===0&&(wn.z=1),wn.normalize(),fr.crossVectors(i,wn),fr.lengthSq()===0&&(Math.abs(i.z)===1?wn.x+=1e-4:wn.z+=1e-4,wn.normalize(),fr.crossVectors(i,wn)),fr.normalize(),Lc.crossVectors(wn,fr),r[0]=fr.x,r[4]=Lc.x,r[8]=wn.x,r[1]=fr.y,r[5]=Lc.y,r[9]=wn.y,r[2]=fr.z,r[6]=Lc.z,r[10]=wn.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let i=e.elements,r=t.elements,s=this.elements,o=i[0],a=i[4],l=i[8],u=i[12],h=i[1],c=i[5],f=i[9],d=i[13],m=i[2],x=i[6],y=i[10],p=i[14],_=i[3],g=i[7],v=i[11],M=i[15],S=r[0],E=r[4],A=r[8],w=r[12],T=r[1],b=r[5],L=r[9],D=r[13],F=r[2],U=r[6],O=r[10],Z=r[14],W=r[3],ne=r[7],re=r[11],de=r[15];return s[0]=o*S+a*T+l*F+u*W,s[4]=o*E+a*b+l*U+u*ne,s[8]=o*A+a*L+l*O+u*re,s[12]=o*w+a*D+l*Z+u*de,s[1]=h*S+c*T+f*F+d*W,s[5]=h*E+c*b+f*U+d*ne,s[9]=h*A+c*L+f*O+d*re,s[13]=h*w+c*D+f*Z+d*de,s[2]=m*S+x*T+y*F+p*W,s[6]=m*E+x*b+y*U+p*ne,s[10]=m*A+x*L+y*O+p*re,s[14]=m*w+x*D+y*Z+p*de,s[3]=_*S+g*T+v*F+M*W,s[7]=_*E+g*b+v*U+M*ne,s[11]=_*A+g*L+v*O+M*re,s[15]=_*w+g*D+v*Z+M*de,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],i=e[4],r=e[8],s=e[12],o=e[1],a=e[5],l=e[9],u=e[13],h=e[2],c=e[6],f=e[10],d=e[14],m=e[3],x=e[7],y=e[11],p=e[15];return m*(+s*l*c-r*u*c-s*a*f+i*u*f+r*a*d-i*l*d)+x*(+t*l*d-t*u*f+s*o*f-r*o*d+r*u*h-s*l*h)+y*(+t*u*c-t*a*d-s*o*c+i*o*d+s*a*h-i*u*h)+p*(-r*a*h-t*l*c+t*a*f+r*o*c-i*o*f+i*l*h)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,i){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=t,r[14]=i),this}invert(){let e=this.elements,t=e[0],i=e[1],r=e[2],s=e[3],o=e[4],a=e[5],l=e[6],u=e[7],h=e[8],c=e[9],f=e[10],d=e[11],m=e[12],x=e[13],y=e[14],p=e[15],_=c*y*u-x*f*u+x*l*d-a*y*d-c*l*p+a*f*p,g=m*f*u-h*y*u-m*l*d+o*y*d+h*l*p-o*f*p,v=h*x*u-m*c*u+m*a*d-o*x*d-h*a*p+o*c*p,M=m*c*l-h*x*l-m*a*f+o*x*f+h*a*y-o*c*y,S=t*_+i*g+r*v+s*M;if(S===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let E=1/S;return e[0]=_*E,e[1]=(x*f*s-c*y*s-x*r*d+i*y*d+c*r*p-i*f*p)*E,e[2]=(a*y*s-x*l*s+x*r*u-i*y*u-a*r*p+i*l*p)*E,e[3]=(c*l*s-a*f*s-c*r*u+i*f*u+a*r*d-i*l*d)*E,e[4]=g*E,e[5]=(h*y*s-m*f*s+m*r*d-t*y*d-h*r*p+t*f*p)*E,e[6]=(m*l*s-o*y*s-m*r*u+t*y*u+o*r*p-t*l*p)*E,e[7]=(o*f*s-h*l*s+h*r*u-t*f*u-o*r*d+t*l*d)*E,e[8]=v*E,e[9]=(m*c*s-h*x*s-m*i*d+t*x*d+h*i*p-t*c*p)*E,e[10]=(o*x*s-m*a*s+m*i*u-t*x*u-o*i*p+t*a*p)*E,e[11]=(h*a*s-o*c*s-h*i*u+t*c*u+o*i*d-t*a*d)*E,e[12]=M*E,e[13]=(h*x*r-m*c*r+m*i*f-t*x*f-h*i*y+t*c*y)*E,e[14]=(m*a*r-o*x*r-m*i*l+t*x*l+o*i*y-t*a*y)*E,e[15]=(o*c*r-h*a*r+h*i*l-t*c*l-o*i*f+t*a*f)*E,this}scale(e){let t=this.elements,i=e.x,r=e.y,s=e.z;return t[0]*=i,t[4]*=r,t[8]*=s,t[1]*=i,t[5]*=r,t[9]*=s,t[2]*=i,t[6]*=r,t[10]*=s,t[3]*=i,t[7]*=r,t[11]*=s,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],i=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,i,r))}makeTranslation(e,t,i){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,i,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),i=Math.sin(e);return this.set(1,0,0,0,0,t,-i,0,0,i,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),i=Math.sin(e);return this.set(t,0,i,0,0,1,0,0,-i,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),i=Math.sin(e);return this.set(t,-i,0,0,i,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let i=Math.cos(t),r=Math.sin(t),s=1-i,o=e.x,a=e.y,l=e.z,u=s*o,h=s*a;return this.set(u*o+i,u*a-r*l,u*l+r*a,0,u*a+r*l,h*a+i,h*l-r*o,0,u*l-r*a,h*l+r*o,s*l*l+i,0,0,0,0,1),this}makeScale(e,t,i){return this.set(e,0,0,0,0,t,0,0,0,0,i,0,0,0,0,1),this}makeShear(e,t,i,r,s,o){return this.set(1,i,s,0,e,1,o,0,t,r,1,0,0,0,0,1),this}compose(e,t,i){let r=this.elements,s=t._x,o=t._y,a=t._z,l=t._w,u=s+s,h=o+o,c=a+a,f=s*u,d=s*h,m=s*c,x=o*h,y=o*c,p=a*c,_=l*u,g=l*h,v=l*c,M=i.x,S=i.y,E=i.z;return r[0]=(1-(x+p))*M,r[1]=(d+v)*M,r[2]=(m-g)*M,r[3]=0,r[4]=(d-v)*S,r[5]=(1-(f+p))*S,r[6]=(y+_)*S,r[7]=0,r[8]=(m+g)*E,r[9]=(y-_)*E,r[10]=(1-(f+x))*E,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,t,i){let r=this.elements,s=Hs.set(r[0],r[1],r[2]).length(),o=Hs.set(r[4],r[5],r[6]).length(),a=Hs.set(r[8],r[9],r[10]).length();this.determinant()<0&&(s=-s),e.x=r[12],e.y=r[13],e.z=r[14],Jn.copy(this);let u=1/s,h=1/o,c=1/a;return Jn.elements[0]*=u,Jn.elements[1]*=u,Jn.elements[2]*=u,Jn.elements[4]*=h,Jn.elements[5]*=h,Jn.elements[6]*=h,Jn.elements[8]*=c,Jn.elements[9]*=c,Jn.elements[10]*=c,t.setFromRotationMatrix(Jn),i.x=s,i.y=o,i.z=a,this}makePerspective(e,t,i,r,s,o,a=Qn,l=!1){let u=this.elements,h=2*s/(t-e),c=2*s/(i-r),f=(t+e)/(t-e),d=(i+r)/(i-r),m,x;if(l)m=s/(o-s),x=o*s/(o-s);else if(a===Qn)m=-(o+s)/(o-s),x=-2*o*s/(o-s);else if(a===wa)m=-o/(o-s),x=-o*s/(o-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return u[0]=h,u[4]=0,u[8]=f,u[12]=0,u[1]=0,u[5]=c,u[9]=d,u[13]=0,u[2]=0,u[6]=0,u[10]=m,u[14]=x,u[3]=0,u[7]=0,u[11]=-1,u[15]=0,this}makeOrthographic(e,t,i,r,s,o,a=Qn,l=!1){let u=this.elements,h=2/(t-e),c=2/(i-r),f=-(t+e)/(t-e),d=-(i+r)/(i-r),m,x;if(l)m=1/(o-s),x=o/(o-s);else if(a===Qn)m=-2/(o-s),x=-(o+s)/(o-s);else if(a===wa)m=-1/(o-s),x=-s/(o-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return u[0]=h,u[4]=0,u[8]=0,u[12]=f,u[1]=0,u[5]=c,u[9]=0,u[13]=d,u[2]=0,u[6]=0,u[10]=m,u[14]=x,u[3]=0,u[7]=0,u[11]=0,u[15]=1,this}equals(e){let t=this.elements,i=e.elements;for(let r=0;r<16;r++)if(t[r]!==i[r])return!1;return!0}fromArray(e,t=0){for(let i=0;i<16;i++)this.elements[i]=e[i+t];return this}toArray(e=[],t=0){let i=this.elements;return e[t]=i[0],e[t+1]=i[1],e[t+2]=i[2],e[t+3]=i[3],e[t+4]=i[4],e[t+5]=i[5],e[t+6]=i[6],e[t+7]=i[7],e[t+8]=i[8],e[t+9]=i[9],e[t+10]=i[10],e[t+11]=i[11],e[t+12]=i[12],e[t+13]=i[13],e[t+14]=i[14],e[t+15]=i[15],e}},Hs=new V,Jn=new Mt,GM=new V(0,0,0),WM=new V(1,1,1),fr=new V,Lc=new V,wn=new V,hx=new Mt,fx=new Fi,ei=class n{constructor(e=0,t=0,i=0,r=n.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=i,this._order=r}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,i,r=this._order){return this._x=e,this._y=t,this._z=i,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,i=!0){let r=e.elements,s=r[0],o=r[4],a=r[8],l=r[1],u=r[5],h=r[9],c=r[2],f=r[6],d=r[10];switch(t){case"XYZ":this._y=Math.asin(Ke(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-h,d),this._z=Math.atan2(-o,s)):(this._x=Math.atan2(f,u),this._z=0);break;case"YXZ":this._x=Math.asin(-Ke(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(a,d),this._z=Math.atan2(l,u)):(this._y=Math.atan2(-c,s),this._z=0);break;case"ZXY":this._x=Math.asin(Ke(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(-c,d),this._z=Math.atan2(-o,u)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-Ke(c,-1,1)),Math.abs(c)<.9999999?(this._x=Math.atan2(f,d),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-o,u));break;case"YZX":this._z=Math.asin(Ke(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-h,u),this._y=Math.atan2(-c,s)):(this._x=0,this._y=Math.atan2(a,d));break;case"XZY":this._z=Math.asin(-Ke(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(f,u),this._y=Math.atan2(a,s)):(this._x=Math.atan2(-h,d),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,i===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,i){return hx.makeRotationFromQuaternion(e),this.setFromRotationMatrix(hx,t,i)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return fx.setFromEuler(this),this.setFromQuaternion(fx,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};ei.DEFAULT_ORDER="XYZ";var no=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},XM=0,dx=new V,Gs=new Fi,Ri=new Mt,Dc=new V,ga=new V,YM=new V,qM=new Fi,px=new V(1,0,0),mx=new V(0,1,0),gx=new V(0,0,1),vx={type:"added"},$M={type:"removed"},Ws={type:"childadded",child:null},sp={type:"childremoved",child:null},Zt=class n extends Ui{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:XM++}),this.uuid=po(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=n.DEFAULT_UP.clone();let e=new V,t=new ei,i=new Fi,r=new V(1,1,1);function s(){i.setFromEuler(t,!1)}function o(){t.setFromQuaternion(i,void 0,!1)}t._onChange(s),i._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:r},modelViewMatrix:{value:new Mt},normalMatrix:{value:new $e}}),this.matrix=new Mt,this.matrixWorld=new Mt,this.matrixAutoUpdate=n.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=n.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new no,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return Gs.setFromAxisAngle(e,t),this.quaternion.multiply(Gs),this}rotateOnWorldAxis(e,t){return Gs.setFromAxisAngle(e,t),this.quaternion.premultiply(Gs),this}rotateX(e){return this.rotateOnAxis(px,e)}rotateY(e){return this.rotateOnAxis(mx,e)}rotateZ(e){return this.rotateOnAxis(gx,e)}translateOnAxis(e,t){return dx.copy(e).applyQuaternion(this.quaternion),this.position.add(dx.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(px,e)}translateY(e){return this.translateOnAxis(mx,e)}translateZ(e){return this.translateOnAxis(gx,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(Ri.copy(this.matrixWorld).invert())}lookAt(e,t,i){e.isVector3?Dc.copy(e):Dc.set(e,t,i);let r=this.parent;this.updateWorldMatrix(!0,!1),ga.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Ri.lookAt(ga,Dc,this.up):Ri.lookAt(Dc,ga,this.up),this.quaternion.setFromRotationMatrix(Ri),r&&(Ri.extractRotation(r.matrixWorld),Gs.setFromRotationMatrix(Ri),this.quaternion.premultiply(Gs.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(vx),Ws.child=e,this.dispatchEvent(Ws),Ws.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent($M),sp.child=e,this.dispatchEvent(sp),sp.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),Ri.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),Ri.multiply(e.parent.matrixWorld)),e.applyMatrix4(Ri),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(vx),Ws.child=e,this.dispatchEvent(Ws),Ws.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let i=0,r=this.children.length;i<r;i++){let o=this.children[i].getObjectByProperty(e,t);if(o!==void 0)return o}}getObjectsByProperty(e,t,i=[]){this[e]===t&&i.push(this);let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].getObjectsByProperty(e,t,i);return i}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(ga,e,YM),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(ga,qM,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);let t=this.children;for(let i=0,r=t.length;i<r;i++)t[i].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let i=0,r=t.length;i<r;i++)t[i].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let i=0,r=t.length;i<r;i++)t[i].updateMatrixWorld(e)}updateWorldMatrix(e,t){let i=this.parent;if(e===!0&&i!==null&&i.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){let r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].updateWorldMatrix(!1,!0)}}toJSON(e){let t=e===void 0||typeof e=="string",i={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let r={};r.uuid=this.uuid,r.type=this.type,this.name!==""&&(r.name=this.name),this.castShadow===!0&&(r.castShadow=!0),this.receiveShadow===!0&&(r.receiveShadow=!0),this.visible===!1&&(r.visible=!1),this.frustumCulled===!1&&(r.frustumCulled=!1),this.renderOrder!==0&&(r.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(r.matrixAutoUpdate=!1),this.isInstancedMesh&&(r.type="InstancedMesh",r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type="BatchedMesh",r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(a=>({...a})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(e),r.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function s(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=s(e.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let l=a.shapes;if(Array.isArray(l))for(let u=0,h=l.length;u<h;u++){let c=l[u];s(e.shapes,c)}else s(e.shapes,l)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let l=0,u=this.material.length;l<u;l++)a.push(s(e.materials,this.material[l]));r.material=a}else r.material=s(e.materials,this.material);if(this.children.length>0){r.children=[];for(let a=0;a<this.children.length;a++)r.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let a=0;a<this.animations.length;a++){let l=this.animations[a];r.animations.push(s(e.animations,l))}}if(t){let a=o(e.geometries),l=o(e.materials),u=o(e.textures),h=o(e.images),c=o(e.shapes),f=o(e.skeletons),d=o(e.animations),m=o(e.nodes);a.length>0&&(i.geometries=a),l.length>0&&(i.materials=l),u.length>0&&(i.textures=u),h.length>0&&(i.images=h),c.length>0&&(i.shapes=c),f.length>0&&(i.skeletons=f),d.length>0&&(i.animations=d),m.length>0&&(i.nodes=m)}return i.object=r,i;function o(a){let l=[];for(let u in a){let h=a[u];delete h.metadata,l.push(h)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let i=0;i<e.children.length;i++){let r=e.children[i];this.add(r.clone())}return this}};Zt.DEFAULT_UP=new V(0,1,0);Zt.DEFAULT_MATRIX_AUTO_UPDATE=!0;Zt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var Kn=new V,Pi=new V,op=new V,Ii=new V,Xs=new V,Ys=new V,xx=new V,ap=new V,lp=new V,cp=new V,up=new wt,hp=new wt,fp=new wt,mr=class n{constructor(e=new V,t=new V,i=new V){this.a=e,this.b=t,this.c=i}static getNormal(e,t,i,r){r.subVectors(i,t),Kn.subVectors(e,t),r.cross(Kn);let s=r.lengthSq();return s>0?r.multiplyScalar(1/Math.sqrt(s)):r.set(0,0,0)}static getBarycoord(e,t,i,r,s){Kn.subVectors(r,t),Pi.subVectors(i,t),op.subVectors(e,t);let o=Kn.dot(Kn),a=Kn.dot(Pi),l=Kn.dot(op),u=Pi.dot(Pi),h=Pi.dot(op),c=o*u-a*a;if(c===0)return s.set(0,0,0),null;let f=1/c,d=(u*l-a*h)*f,m=(o*h-a*l)*f;return s.set(1-d-m,m,d)}static containsPoint(e,t,i,r){return this.getBarycoord(e,t,i,r,Ii)===null?!1:Ii.x>=0&&Ii.y>=0&&Ii.x+Ii.y<=1}static getInterpolation(e,t,i,r,s,o,a,l){return this.getBarycoord(e,t,i,r,Ii)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,Ii.x),l.addScaledVector(o,Ii.y),l.addScaledVector(a,Ii.z),l)}static getInterpolatedAttribute(e,t,i,r,s,o){return up.setScalar(0),hp.setScalar(0),fp.setScalar(0),up.fromBufferAttribute(e,t),hp.fromBufferAttribute(e,i),fp.fromBufferAttribute(e,r),o.setScalar(0),o.addScaledVector(up,s.x),o.addScaledVector(hp,s.y),o.addScaledVector(fp,s.z),o}static isFrontFacing(e,t,i,r){return Kn.subVectors(i,t),Pi.subVectors(e,t),Kn.cross(Pi).dot(r)<0}set(e,t,i){return this.a.copy(e),this.b.copy(t),this.c.copy(i),this}setFromPointsAndIndices(e,t,i,r){return this.a.copy(e[t]),this.b.copy(e[i]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,t,i,r){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,i),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Kn.subVectors(this.c,this.b),Pi.subVectors(this.a,this.b),Kn.cross(Pi).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return n.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return n.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,i,r,s){return n.getInterpolation(e,this.a,this.b,this.c,t,i,r,s)}containsPoint(e){return n.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return n.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let i=this.a,r=this.b,s=this.c,o,a;Xs.subVectors(r,i),Ys.subVectors(s,i),ap.subVectors(e,i);let l=Xs.dot(ap),u=Ys.dot(ap);if(l<=0&&u<=0)return t.copy(i);lp.subVectors(e,r);let h=Xs.dot(lp),c=Ys.dot(lp);if(h>=0&&c<=h)return t.copy(r);let f=l*c-h*u;if(f<=0&&l>=0&&h<=0)return o=l/(l-h),t.copy(i).addScaledVector(Xs,o);cp.subVectors(e,s);let d=Xs.dot(cp),m=Ys.dot(cp);if(m>=0&&d<=m)return t.copy(s);let x=d*u-l*m;if(x<=0&&u>=0&&m<=0)return a=u/(u-m),t.copy(i).addScaledVector(Ys,a);let y=h*m-d*c;if(y<=0&&c-h>=0&&d-m>=0)return xx.subVectors(s,r),a=(c-h)/(c-h+(d-m)),t.copy(r).addScaledVector(xx,a);let p=1/(y+x+f);return o=x*p,a=f*p,t.copy(i).addScaledVector(Xs,o).addScaledVector(Ys,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},Sy={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},dr={h:0,s:0,l:0},Nc={h:0,s:0,l:0};function dp(n,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?n+(e-n)*6*t:t<1/2?e:t<2/3?n+(e-n)*6*(2/3-t):n}var je=class{constructor(e,t,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,i)}set(e,t,i){if(t===void 0&&i===void 0){let r=e;r&&r.isColor?this.copy(r):typeof r=="number"?this.setHex(r):typeof r=="string"&&this.setStyle(r)}else this.setRGB(e,t,i);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=qt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,tt.colorSpaceToWorking(this,t),this}setRGB(e,t,i,r=tt.workingColorSpace){return this.r=e,this.g=t,this.b=i,tt.colorSpaceToWorking(this,r),this}setHSL(e,t,i,r=tt.workingColorSpace){if(e=BM(e,1),t=Ke(t,0,1),i=Ke(i,0,1),t===0)this.r=this.g=this.b=i;else{let s=i<=.5?i*(1+t):i+t-i*t,o=2*i-s;this.r=dp(o,s,e+1/3),this.g=dp(o,s,e),this.b=dp(o,s,e-1/3)}return tt.colorSpaceToWorking(this,r),this}setStyle(e,t=qt){function i(s){s!==void 0&&parseFloat(s)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let s,o=r[1],a=r[2];switch(o){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,t);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,t);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let s=r[1],o=s.length;if(o===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,t);if(o===6)return this.setHex(parseInt(s,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=qt){let i=Sy[e.toLowerCase()];return i!==void 0?this.setHex(i,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Di(e.r),this.g=Di(e.g),this.b=Di(e.b),this}copyLinearToSRGB(e){return this.r=Js(e.r),this.g=Js(e.g),this.b=Js(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=qt){return tt.workingToColorSpace(Yt.copy(this),e),Math.round(Ke(Yt.r*255,0,255))*65536+Math.round(Ke(Yt.g*255,0,255))*256+Math.round(Ke(Yt.b*255,0,255))}getHexString(e=qt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=tt.workingColorSpace){tt.workingToColorSpace(Yt.copy(this),t);let i=Yt.r,r=Yt.g,s=Yt.b,o=Math.max(i,r,s),a=Math.min(i,r,s),l,u,h=(a+o)/2;if(a===o)l=0,u=0;else{let c=o-a;switch(u=h<=.5?c/(o+a):c/(2-o-a),o){case i:l=(r-s)/c+(r<s?6:0);break;case r:l=(s-i)/c+2;break;case s:l=(i-r)/c+4;break}l/=6}return e.h=l,e.s=u,e.l=h,e}getRGB(e,t=tt.workingColorSpace){return tt.workingToColorSpace(Yt.copy(this),t),e.r=Yt.r,e.g=Yt.g,e.b=Yt.b,e}getStyle(e=qt){tt.workingToColorSpace(Yt.copy(this),e);let t=Yt.r,i=Yt.g,r=Yt.b;return e!==qt?`color(${e} ${t.toFixed(3)} ${i.toFixed(3)} ${r.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(i*255)},${Math.round(r*255)})`}offsetHSL(e,t,i){return this.getHSL(dr),this.setHSL(dr.h+e,dr.s+t,dr.l+i)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,i){return this.r=e.r+(t.r-e.r)*i,this.g=e.g+(t.g-e.g)*i,this.b=e.b+(t.b-e.b)*i,this}lerpHSL(e,t){this.getHSL(dr),e.getHSL(Nc);let i=Zd(dr.h,Nc.h,t),r=Zd(dr.s,Nc.s,t),s=Zd(dr.l,Nc.l,t);return this.setHSL(i,r,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,i=this.g,r=this.b,s=e.elements;return this.r=s[0]*t+s[3]*i+s[6]*r,this.g=s[1]*t+s[4]*i+s[7]*r,this.b=s[2]*t+s[5]*i+s[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},Yt=new je;je.NAMES=Sy;var ZM=0,Oi=class extends Ui{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:ZM++}),this.uuid=po(),this.name="",this.type="Material",this.blending=Xr,this.side=Ni,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Zc,this.blendDst=Jc,this.blendEquation=vr,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new je(0,0,0),this.blendAlpha=0,this.depthFunc=Yr,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Ep,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Wr,this.stencilZFail=Wr,this.stencilZPass=Wr,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let i=e[t];if(i===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}let r=this[t];if(r===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(i):r&&r.isVector3&&i&&i.isVector3?r.copy(i):this[t]=i}}toJSON(e){let t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});let i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(e).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(e).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(e).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(e).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(e).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==Xr&&(i.blending=this.blending),this.side!==Ni&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==Zc&&(i.blendSrc=this.blendSrc),this.blendDst!==Jc&&(i.blendDst=this.blendDst),this.blendEquation!==vr&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==Yr&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Ep&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==Wr&&(i.stencilFail=this.stencilFail),this.stencilZFail!==Wr&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==Wr&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function r(s){let o=[];for(let a in s){let l=s[a];delete l.metadata,o.push(l)}return o}if(t){let s=r(e.textures),o=r(e.images);s.length>0&&(i.textures=s),o.length>0&&(i.images=o)}return i}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,i=null;if(t!==null){let r=t.length;i=new Array(r);for(let s=0;s!==r;++s)i[s]=t[s].clone()}return this.clippingPlanes=i,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}},ba=class extends Oi{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new je(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new ei,this.combine=Bp,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}};var Ct=new V,Uc=new Se,JM=0,Tn=class{constructor(e,t,i=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:JM++}),this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=i,this.usage=Tp,this.updateRanges=[],this.gpuType=pi,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,i){e*=this.itemSize,i*=t.itemSize;for(let r=0,s=this.itemSize;r<s;r++)this.array[e+r]=t.array[i+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,i=this.count;t<i;t++)Uc.fromBufferAttribute(this,t),Uc.applyMatrix3(e),this.setXY(t,Uc.x,Uc.y);else if(this.itemSize===3)for(let t=0,i=this.count;t<i;t++)Ct.fromBufferAttribute(this,t),Ct.applyMatrix3(e),this.setXYZ(t,Ct.x,Ct.y,Ct.z);return this}applyMatrix4(e){for(let t=0,i=this.count;t<i;t++)Ct.fromBufferAttribute(this,t),Ct.applyMatrix4(e),this.setXYZ(t,Ct.x,Ct.y,Ct.z);return this}applyNormalMatrix(e){for(let t=0,i=this.count;t<i;t++)Ct.fromBufferAttribute(this,t),Ct.applyNormalMatrix(e),this.setXYZ(t,Ct.x,Ct.y,Ct.z);return this}transformDirection(e){for(let t=0,i=this.count;t<i;t++)Ct.fromBufferAttribute(this,t),Ct.transformDirection(e),this.setXYZ(t,Ct.x,Ct.y,Ct.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let i=this.array[e*this.itemSize+t];return this.normalized&&(i=da(i,this.array)),i}setComponent(e,t,i){return this.normalized&&(i=fn(i,this.array)),this.array[e*this.itemSize+t]=i,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=da(t,this.array)),t}setX(e,t){return this.normalized&&(t=fn(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=da(t,this.array)),t}setY(e,t){return this.normalized&&(t=fn(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=da(t,this.array)),t}setZ(e,t){return this.normalized&&(t=fn(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=da(t,this.array)),t}setW(e,t){return this.normalized&&(t=fn(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,i){return e*=this.itemSize,this.normalized&&(t=fn(t,this.array),i=fn(i,this.array)),this.array[e+0]=t,this.array[e+1]=i,this}setXYZ(e,t,i,r){return e*=this.itemSize,this.normalized&&(t=fn(t,this.array),i=fn(i,this.array),r=fn(r,this.array)),this.array[e+0]=t,this.array[e+1]=i,this.array[e+2]=r,this}setXYZW(e,t,i,r,s){return e*=this.itemSize,this.normalized&&(t=fn(t,this.array),i=fn(i,this.array),r=fn(r,this.array),s=fn(s,this.array)),this.array[e+0]=t,this.array[e+1]=i,this.array[e+2]=r,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==Tp&&(e.usage=this.usage),e}};var Ca=class extends Tn{constructor(e,t,i){super(new Uint16Array(e),t,i)}};var Ra=class extends Tn{constructor(e,t,i){super(new Uint32Array(e),t,i)}};var $t=class extends Tn{constructor(e,t,i){super(new Float32Array(e),t,i)}},KM=0,On=new Mt,pp=new Zt,qs=new V,En=new xr,va=new xr,Ut=new V,ti=class n extends Ui{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:KM++}),this.uuid=po(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Kp(e)?Ra:Ca)(e,1):this.index=e,this}setIndirect(e){return this.indirect=e,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,i=0){this.groups.push({start:e,count:t,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let i=this.attributes.normal;if(i!==void 0){let s=new $e().getNormalMatrix(e);i.applyNormalMatrix(s),i.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return On.makeRotationFromQuaternion(e),this.applyMatrix4(On),this}rotateX(e){return On.makeRotationX(e),this.applyMatrix4(On),this}rotateY(e){return On.makeRotationY(e),this.applyMatrix4(On),this}rotateZ(e){return On.makeRotationZ(e),this.applyMatrix4(On),this}translate(e,t,i){return On.makeTranslation(e,t,i),this.applyMatrix4(On),this}scale(e,t,i){return On.makeScale(e,t,i),this.applyMatrix4(On),this}lookAt(e){return pp.lookAt(e),pp.updateMatrix(),this.applyMatrix4(pp.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(qs).negate(),this.translate(qs.x,qs.y,qs.z),this}setFromPoints(e){let t=this.getAttribute("position");if(t===void 0){let i=[];for(let r=0,s=e.length;r<s;r++){let o=e[r];i.push(o.x,o.y,o.z||0)}this.setAttribute("position",new $t(i,3))}else{let i=Math.min(e.length,t.count);for(let r=0;r<i;r++){let s=e[r];t.setXYZ(r,s.x,s.y,s.z||0)}e.length>t.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new xr);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new V(-1/0,-1/0,-1/0),new V(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let i=0,r=t.length;i<r;i++){let s=t[i];En.setFromBufferAttribute(s),this.morphTargetsRelative?(Ut.addVectors(this.boundingBox.min,En.min),this.boundingBox.expandByPoint(Ut),Ut.addVectors(this.boundingBox.max,En.max),this.boundingBox.expandByPoint(Ut)):(this.boundingBox.expandByPoint(En.min),this.boundingBox.expandByPoint(En.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new to);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new V,1/0);return}if(e){let i=this.boundingSphere.center;if(En.setFromBufferAttribute(e),t)for(let s=0,o=t.length;s<o;s++){let a=t[s];va.setFromBufferAttribute(a),this.morphTargetsRelative?(Ut.addVectors(En.min,va.min),En.expandByPoint(Ut),Ut.addVectors(En.max,va.max),En.expandByPoint(Ut)):(En.expandByPoint(va.min),En.expandByPoint(va.max))}En.getCenter(i);let r=0;for(let s=0,o=e.count;s<o;s++)Ut.fromBufferAttribute(e,s),r=Math.max(r,i.distanceToSquared(Ut));if(t)for(let s=0,o=t.length;s<o;s++){let a=t[s],l=this.morphTargetsRelative;for(let u=0,h=a.count;u<h;u++)Ut.fromBufferAttribute(a,u),l&&(qs.fromBufferAttribute(e,u),Ut.add(qs)),r=Math.max(r,i.distanceToSquared(Ut))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let i=t.position,r=t.normal,s=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Tn(new Float32Array(4*i.count),4));let o=this.getAttribute("tangent"),a=[],l=[];for(let A=0;A<i.count;A++)a[A]=new V,l[A]=new V;let u=new V,h=new V,c=new V,f=new Se,d=new Se,m=new Se,x=new V,y=new V;function p(A,w,T){u.fromBufferAttribute(i,A),h.fromBufferAttribute(i,w),c.fromBufferAttribute(i,T),f.fromBufferAttribute(s,A),d.fromBufferAttribute(s,w),m.fromBufferAttribute(s,T),h.sub(u),c.sub(u),d.sub(f),m.sub(f);let b=1/(d.x*m.y-m.x*d.y);isFinite(b)&&(x.copy(h).multiplyScalar(m.y).addScaledVector(c,-d.y).multiplyScalar(b),y.copy(c).multiplyScalar(d.x).addScaledVector(h,-m.x).multiplyScalar(b),a[A].add(x),a[w].add(x),a[T].add(x),l[A].add(y),l[w].add(y),l[T].add(y))}let _=this.groups;_.length===0&&(_=[{start:0,count:e.count}]);for(let A=0,w=_.length;A<w;++A){let T=_[A],b=T.start,L=T.count;for(let D=b,F=b+L;D<F;D+=3)p(e.getX(D+0),e.getX(D+1),e.getX(D+2))}let g=new V,v=new V,M=new V,S=new V;function E(A){M.fromBufferAttribute(r,A),S.copy(M);let w=a[A];g.copy(w),g.sub(M.multiplyScalar(M.dot(w))).normalize(),v.crossVectors(S,w);let b=v.dot(l[A])<0?-1:1;o.setXYZW(A,g.x,g.y,g.z,b)}for(let A=0,w=_.length;A<w;++A){let T=_[A],b=T.start,L=T.count;for(let D=b,F=b+L;D<F;D+=3)E(e.getX(D+0)),E(e.getX(D+1)),E(e.getX(D+2))}}computeVertexNormals(){let e=this.index,t=this.getAttribute("position");if(t!==void 0){let i=this.getAttribute("normal");if(i===void 0)i=new Tn(new Float32Array(t.count*3),3),this.setAttribute("normal",i);else for(let f=0,d=i.count;f<d;f++)i.setXYZ(f,0,0,0);let r=new V,s=new V,o=new V,a=new V,l=new V,u=new V,h=new V,c=new V;if(e)for(let f=0,d=e.count;f<d;f+=3){let m=e.getX(f+0),x=e.getX(f+1),y=e.getX(f+2);r.fromBufferAttribute(t,m),s.fromBufferAttribute(t,x),o.fromBufferAttribute(t,y),h.subVectors(o,s),c.subVectors(r,s),h.cross(c),a.fromBufferAttribute(i,m),l.fromBufferAttribute(i,x),u.fromBufferAttribute(i,y),a.add(h),l.add(h),u.add(h),i.setXYZ(m,a.x,a.y,a.z),i.setXYZ(x,l.x,l.y,l.z),i.setXYZ(y,u.x,u.y,u.z)}else for(let f=0,d=t.count;f<d;f+=3)r.fromBufferAttribute(t,f+0),s.fromBufferAttribute(t,f+1),o.fromBufferAttribute(t,f+2),h.subVectors(o,s),c.subVectors(r,s),h.cross(c),i.setXYZ(f+0,h.x,h.y,h.z),i.setXYZ(f+1,h.x,h.y,h.z),i.setXYZ(f+2,h.x,h.y,h.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,i=e.count;t<i;t++)Ut.fromBufferAttribute(e,t),Ut.normalize(),e.setXYZ(t,Ut.x,Ut.y,Ut.z)}toNonIndexed(){function e(a,l){let u=a.array,h=a.itemSize,c=a.normalized,f=new u.constructor(l.length*h),d=0,m=0;for(let x=0,y=l.length;x<y;x++){a.isInterleavedBufferAttribute?d=l[x]*a.data.stride+a.offset:d=l[x]*h;for(let p=0;p<h;p++)f[m++]=u[d++]}return new Tn(f,h,c)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let t=new n,i=this.index.array,r=this.attributes;for(let a in r){let l=r[a],u=e(l,i);t.setAttribute(a,u)}let s=this.morphAttributes;for(let a in s){let l=[],u=s[a];for(let h=0,c=u.length;h<c;h++){let f=u[h],d=e(f,i);l.push(d)}t.morphAttributes[a]=l}t.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,l=o.length;a<l;a++){let u=o[a];t.addGroup(u.start,u.count,u.materialIndex)}return t}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let u in l)l[u]!==void 0&&(e[u]=l[u]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let i=this.attributes;for(let l in i){let u=i[l];e.data.attributes[l]=u.toJSON(e.data)}let r={},s=!1;for(let l in this.morphAttributes){let u=this.morphAttributes[l],h=[];for(let c=0,f=u.length;c<f;c++){let d=u[c];h.push(d.toJSON(e.data))}h.length>0&&(r[l]=h,s=!0)}s&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(e.data.boundingSphere=a.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let i=e.index;i!==null&&this.setIndex(i.clone());let r=e.attributes;for(let u in r){let h=r[u];this.setAttribute(u,h.clone(t))}let s=e.morphAttributes;for(let u in s){let h=[],c=s[u];for(let f=0,d=c.length;f<d;f++)h.push(c[f].clone(t));this.morphAttributes[u]=h}this.morphTargetsRelative=e.morphTargetsRelative;let o=e.groups;for(let u=0,h=o.length;u<h;u++){let c=o[u];this.addGroup(c.start,c.count,c.materialIndex)}let a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}},yx=new Mt,Hr=new Aa,Fc=new to,_x=new V,Oc=new V,Bc=new V,kc=new V,mp=new V,zc=new V,Sx=new V,Vc=new V,rn=class extends Zt{constructor(e=new ti,t=new ba){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let t=this.geometry.morphAttributes,i=Object.keys(t);if(i.length>0){let r=t[i[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){let a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}getVertexPosition(e,t){let i=this.geometry,r=i.attributes.position,s=i.morphAttributes.position,o=i.morphTargetsRelative;t.fromBufferAttribute(r,e);let a=this.morphTargetInfluences;if(s&&a){zc.set(0,0,0);for(let l=0,u=s.length;l<u;l++){let h=a[l],c=s[l];h!==0&&(mp.fromBufferAttribute(c,e),o?zc.addScaledVector(mp,h):zc.addScaledVector(mp.sub(t),h))}t.add(zc)}return t}raycast(e,t){let i=this.geometry,r=this.material,s=this.matrixWorld;r!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),Fc.copy(i.boundingSphere),Fc.applyMatrix4(s),Hr.copy(e.ray).recast(e.near),!(Fc.containsPoint(Hr.origin)===!1&&(Hr.intersectSphere(Fc,_x)===null||Hr.origin.distanceToSquared(_x)>(e.far-e.near)**2))&&(yx.copy(s).invert(),Hr.copy(e.ray).applyMatrix4(yx),!(i.boundingBox!==null&&Hr.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(e,t,Hr)))}_computeIntersections(e,t,i){let r,s=this.geometry,o=this.material,a=s.index,l=s.attributes.position,u=s.attributes.uv,h=s.attributes.uv1,c=s.attributes.normal,f=s.groups,d=s.drawRange;if(a!==null)if(Array.isArray(o))for(let m=0,x=f.length;m<x;m++){let y=f[m],p=o[y.materialIndex],_=Math.max(y.start,d.start),g=Math.min(a.count,Math.min(y.start+y.count,d.start+d.count));for(let v=_,M=g;v<M;v+=3){let S=a.getX(v),E=a.getX(v+1),A=a.getX(v+2);r=Hc(this,p,e,i,u,h,c,S,E,A),r&&(r.faceIndex=Math.floor(v/3),r.face.materialIndex=y.materialIndex,t.push(r))}}else{let m=Math.max(0,d.start),x=Math.min(a.count,d.start+d.count);for(let y=m,p=x;y<p;y+=3){let _=a.getX(y),g=a.getX(y+1),v=a.getX(y+2);r=Hc(this,o,e,i,u,h,c,_,g,v),r&&(r.faceIndex=Math.floor(y/3),t.push(r))}}else if(l!==void 0)if(Array.isArray(o))for(let m=0,x=f.length;m<x;m++){let y=f[m],p=o[y.materialIndex],_=Math.max(y.start,d.start),g=Math.min(l.count,Math.min(y.start+y.count,d.start+d.count));for(let v=_,M=g;v<M;v+=3){let S=v,E=v+1,A=v+2;r=Hc(this,p,e,i,u,h,c,S,E,A),r&&(r.faceIndex=Math.floor(v/3),r.face.materialIndex=y.materialIndex,t.push(r))}}else{let m=Math.max(0,d.start),x=Math.min(l.count,d.start+d.count);for(let y=m,p=x;y<p;y+=3){let _=y,g=y+1,v=y+2;r=Hc(this,o,e,i,u,h,c,_,g,v),r&&(r.faceIndex=Math.floor(y/3),t.push(r))}}}};function QM(n,e,t,i,r,s,o,a){let l;if(e.side===sn?l=i.intersectTriangle(o,s,r,!0,a):l=i.intersectTriangle(r,s,o,e.side===Ni,a),l===null)return null;Vc.copy(a),Vc.applyMatrix4(n.matrixWorld);let u=t.ray.origin.distanceTo(Vc);return u<t.near||u>t.far?null:{distance:u,point:Vc.clone(),object:n}}function Hc(n,e,t,i,r,s,o,a,l,u){n.getVertexPosition(a,Oc),n.getVertexPosition(l,Bc),n.getVertexPosition(u,kc);let h=QM(n,e,t,i,Oc,Bc,kc,Sx);if(h){let c=new V;mr.getBarycoord(Sx,Oc,Bc,kc,c),r&&(h.uv=mr.getInterpolatedAttribute(r,a,l,u,c,new Se)),s&&(h.uv1=mr.getInterpolatedAttribute(s,a,l,u,c,new Se)),o&&(h.normal=mr.getInterpolatedAttribute(o,a,l,u,c,new V),h.normal.dot(i.direction)>0&&h.normal.multiplyScalar(-1));let f={a,b:l,c:u,normal:new V,materialIndex:0};mr.getNormal(Oc,Bc,kc,f.normal),h.face=f,h.barycoord=c}return h}var io=class n extends ti{constructor(e=1,t=1,i=1,r=1,s=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:i,widthSegments:r,heightSegments:s,depthSegments:o};let a=this;r=Math.floor(r),s=Math.floor(s),o=Math.floor(o);let l=[],u=[],h=[],c=[],f=0,d=0;m("z","y","x",-1,-1,i,t,e,o,s,0),m("z","y","x",1,-1,i,t,-e,o,s,1),m("x","z","y",1,1,e,i,t,r,o,2),m("x","z","y",1,-1,e,i,-t,r,o,3),m("x","y","z",1,-1,e,t,i,r,s,4),m("x","y","z",-1,-1,e,t,-i,r,s,5),this.setIndex(l),this.setAttribute("position",new $t(u,3)),this.setAttribute("normal",new $t(h,3)),this.setAttribute("uv",new $t(c,2));function m(x,y,p,_,g,v,M,S,E,A,w){let T=v/E,b=M/A,L=v/2,D=M/2,F=S/2,U=E+1,O=A+1,Z=0,W=0,ne=new V;for(let re=0;re<O;re++){let de=re*b-D;for(let Ue=0;Ue<U;Ue++){let He=Ue*T-L;ne[x]=He*_,ne[y]=de*g,ne[p]=F,u.push(ne.x,ne.y,ne.z),ne[x]=0,ne[y]=0,ne[p]=S>0?1:-1,h.push(ne.x,ne.y,ne.z),c.push(Ue/E),c.push(1-re/A),Z+=1}}for(let re=0;re<A;re++)for(let de=0;de<E;de++){let Ue=f+de+U*re,He=f+de+U*(re+1),Ee=f+(de+1)+U*(re+1),Ve=f+(de+1)+U*re;l.push(Ue,He,Ve),l.push(He,Ee,Ve),W+=6}a.addGroup(d,W,w),d+=W,f+=Z}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new n(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};function ns(n){let e={};for(let t in n){e[t]={};for(let i in n[t]){let r=n[t][i];r&&(r.isColor||r.isMatrix3||r.isMatrix4||r.isVector2||r.isVector3||r.isVector4||r.isTexture||r.isQuaternion)?r.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][i]=null):e[t][i]=r.clone():Array.isArray(r)?e[t][i]=r.slice():e[t][i]=r}}return e}function Jt(n){let e={};for(let t=0;t<n.length;t++){let i=ns(n[t]);for(let r in i)e[r]=i[r]}return e}function jM(n){let e=[];for(let t=0;t<n.length;t++)e.push(n[t].clone());return e}function Qp(n){let e=n.getRenderTarget();return e===null?n.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:tt.workingColorSpace}var My={clone:ns,merge:Jt},e1=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,t1=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,ni=class extends Oi{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=e1,this.fragmentShader=t1,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=ns(e.uniforms),this.uniformsGroups=jM(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let r in this.uniforms){let o=this.uniforms[r].value;o&&o.isTexture?t.uniforms[r]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?t.uniforms[r]={type:"c",value:o.getHex()}:o&&o.isVector2?t.uniforms[r]={type:"v2",value:o.toArray()}:o&&o.isVector3?t.uniforms[r]={type:"v3",value:o.toArray()}:o&&o.isVector4?t.uniforms[r]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?t.uniforms[r]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?t.uniforms[r]={type:"m4",value:o.toArray()}:t.uniforms[r]={value:o}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let i={};for(let r in this.extensions)this.extensions[r]===!0&&(i[r]=!0);return Object.keys(i).length>0&&(t.extensions=i),t}},Pa=class extends Zt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Mt,this.projectionMatrix=new Mt,this.projectionMatrixInverse=new Mt,this.coordinateSystem=Qn,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}},pr=new V,Mx=new Se,wx=new Se,dn=class extends Pa{constructor(e=50,t=1,i=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=i,this.far=r,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=eu*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan($d*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return eu*2*Math.atan(Math.tan($d*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,i){pr.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(pr.x,pr.y).multiplyScalar(-e/pr.z),pr.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(pr.x,pr.y).multiplyScalar(-e/pr.z)}getViewSize(e,t){return this.getViewBounds(e,Mx,wx),t.subVectors(wx,Mx)}setViewOffset(e,t,i,r,s,o){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan($d*.5*this.fov)/this.zoom,i=2*t,r=this.aspect*i,s=-.5*r,o=this.view;if(this.view!==null&&this.view.enabled){let l=o.fullWidth,u=o.fullHeight;s+=o.offsetX*r/l,t-=o.offsetY*i/u,r*=o.width/l,i*=o.height/u}let a=this.filmOffset;a!==0&&(s+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+r,t,t-i,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}},$s=-90,Zs=1,ru=class extends Zt{constructor(e,t,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;let r=new dn($s,Zs,e,t);r.layers=this.layers,this.add(r);let s=new dn($s,Zs,e,t);s.layers=this.layers,this.add(s);let o=new dn($s,Zs,e,t);o.layers=this.layers,this.add(o);let a=new dn($s,Zs,e,t);a.layers=this.layers,this.add(a);let l=new dn($s,Zs,e,t);l.layers=this.layers,this.add(l);let u=new dn($s,Zs,e,t);u.layers=this.layers,this.add(u)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[i,r,s,o,a,l]=t;for(let u of t)this.remove(u);if(e===Qn)i.up.set(0,1,0),i.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===wa)i.up.set(0,-1,0),i.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let u of t)this.add(u),u.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:i,activeMipmapLevel:r}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[s,o,a,l,u,h]=this.children,c=e.getRenderTarget(),f=e.getActiveCubeFace(),d=e.getActiveMipmapLevel(),m=e.xr.enabled;e.xr.enabled=!1;let x=i.texture.generateMipmaps;i.texture.generateMipmaps=!1,e.setRenderTarget(i,0,r),e.render(t,s),e.setRenderTarget(i,1,r),e.render(t,o),e.setRenderTarget(i,2,r),e.render(t,a),e.setRenderTarget(i,3,r),e.render(t,l),e.setRenderTarget(i,4,r),e.render(t,u),i.texture.generateMipmaps=x,e.setRenderTarget(i,5,r),e.render(t,h),e.setRenderTarget(c,f,d),e.xr.enabled=m,i.texture.needsPMREMUpdate=!0}},Ia=class extends pn{constructor(e=[],t=es,i,r,s,o,a,l,u,h){super(e,t,i,r,s,o,a,l,u,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},su=class extends hi{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let i={width:e,height:e,depth:1},r=[i,i,i,i,i,i];this.texture=new Ia(r),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let i={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},r=new io(5,5,5),s=new ni({name:"CubemapFromEquirect",uniforms:ns(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:sn,blending:Bi});s.uniforms.tEquirect.value=t;let o=new rn(r,s),a=t.minFilter;return t.minFilter===Sr&&(t.minFilter=jn),new ru(1,10,this).update(e,o),t.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,t=!0,i=!0,r=!0){let s=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(t,i,r);e.setRenderTarget(s)}},Li=class extends Zt{constructor(){super(),this.isGroup=!0,this.type="Group"}},n1={type:"move"},ro=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Li,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Li,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new V,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new V),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Li,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new V,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new V),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let i of e.hand.values())this._getHandJoint(t,i)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,i){let r=null,s=null,o=null,a=this._targetRay,l=this._grip,u=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(u&&e.hand){o=!0;for(let x of e.hand.values()){let y=t.getJointPose(x,i),p=this._getHandJoint(u,x);y!==null&&(p.matrix.fromArray(y.transform.matrix),p.matrix.decompose(p.position,p.rotation,p.scale),p.matrixWorldNeedsUpdate=!0,p.jointRadius=y.radius),p.visible=y!==null}let h=u.joints["index-finger-tip"],c=u.joints["thumb-tip"],f=h.position.distanceTo(c.position),d=.02,m=.005;u.inputState.pinching&&f>d+m?(u.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!u.inputState.pinching&&f<=d-m&&(u.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(s=t.getPose(e.gripSpace,i),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1));a!==null&&(r=t.getPose(e.targetRaySpace,i),r===null&&s!==null&&(r=s),r!==null&&(a.matrix.fromArray(r.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,r.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(r.linearVelocity)):a.hasLinearVelocity=!1,r.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(r.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(n1)))}return a!==null&&(a.visible=r!==null),l!==null&&(l.visible=s!==null),u!==null&&(u.visible=o!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let i=new Li;i.matrixAutoUpdate=!1,i.visible=!1,e.joints[t.jointName]=i,e.add(i)}return e.joints[t.jointName]}};var La=class extends Zt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new ei,this.environmentIntensity=1,this.environmentRotation=new ei,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}};var gp=new V,i1=new V,r1=new $e,Bn=class{constructor(e=new V(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,i,r){return this.normal.set(e,t,i),this.constant=r,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,i){let r=gp.subVectors(i,t).cross(i1.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){let i=e.delta(gp),r=this.normal.dot(i);if(r===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let s=-(e.start.dot(this.normal)+this.constant)/r;return s<0||s>1?null:t.copy(e.start).addScaledVector(i,s)}intersectsLine(e){let t=this.distanceToPoint(e.start),i=this.distanceToPoint(e.end);return t<0&&i>0||i<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let i=t||r1.getNormalMatrix(e),r=this.coplanarPoint(gp).applyMatrix4(e),s=this.normal.applyMatrix3(i).normalize();return this.constant=-r.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},Gr=new to,s1=new Se(.5,.5),Gc=new V,so=class{constructor(e=new Bn,t=new Bn,i=new Bn,r=new Bn,s=new Bn,o=new Bn){this.planes=[e,t,i,r,s,o]}set(e,t,i,r,s,o){let a=this.planes;return a[0].copy(e),a[1].copy(t),a[2].copy(i),a[3].copy(r),a[4].copy(s),a[5].copy(o),this}copy(e){let t=this.planes;for(let i=0;i<6;i++)t[i].copy(e.planes[i]);return this}setFromProjectionMatrix(e,t=Qn,i=!1){let r=this.planes,s=e.elements,o=s[0],a=s[1],l=s[2],u=s[3],h=s[4],c=s[5],f=s[6],d=s[7],m=s[8],x=s[9],y=s[10],p=s[11],_=s[12],g=s[13],v=s[14],M=s[15];if(r[0].setComponents(u-o,d-h,p-m,M-_).normalize(),r[1].setComponents(u+o,d+h,p+m,M+_).normalize(),r[2].setComponents(u+a,d+c,p+x,M+g).normalize(),r[3].setComponents(u-a,d-c,p-x,M-g).normalize(),i)r[4].setComponents(l,f,y,v).normalize(),r[5].setComponents(u-l,d-f,p-y,M-v).normalize();else if(r[4].setComponents(u-l,d-f,p-y,M-v).normalize(),t===Qn)r[5].setComponents(u+l,d+f,p+y,M+v).normalize();else if(t===wa)r[5].setComponents(l,f,y,v).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Gr.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),Gr.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Gr)}intersectsSprite(e){Gr.center.set(0,0,0);let t=s1.distanceTo(e.center);return Gr.radius=.7071067811865476+t,Gr.applyMatrix4(e.matrixWorld),this.intersectsSphere(Gr)}intersectsSphere(e){let t=this.planes,i=e.center,r=-e.radius;for(let s=0;s<6;s++)if(t[s].distanceToPoint(i)<r)return!1;return!0}intersectsBox(e){let t=this.planes;for(let i=0;i<6;i++){let r=t[i];if(Gc.x=r.normal.x>0?e.max.x:e.min.x,Gc.y=r.normal.y>0?e.max.y:e.min.y,Gc.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(Gc)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let i=0;i<6;i++)if(t[i].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var Da=class extends pn{constructor(e,t,i,r,s,o,a,l,u){super(e,t,i,r,s,o,a,l,u),this.isCanvasTexture=!0,this.needsUpdate=!0}},Na=class extends pn{constructor(e,t,i=Mr,r,s,o,a=kn,l=kn,u,h=Qs,c=1){if(h!==Qs&&h!==fo)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let f={width:e,height:t,depth:c};super(f,r,s,o,a,l,h,i,u),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new eo(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}},Ua=class extends pn{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}};var An=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){console.warn("THREE.Curve: .getPoint() not implemented.")}getPointAt(e,t){let i=this.getUtoTmapping(e);return this.getPoint(i,t)}getPoints(e=5){let t=[];for(let i=0;i<=e;i++)t.push(this.getPoint(i/e));return t}getSpacedPoints(e=5){let t=[];for(let i=0;i<=e;i++)t.push(this.getPointAt(i/e));return t}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let t=[],i,r=this.getPoint(0),s=0;t.push(0);for(let o=1;o<=e;o++)i=this.getPoint(o/e),s+=i.distanceTo(r),t.push(s),r=i;return this.cacheArcLengths=t,t}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,t=null){let i=this.getLengths(),r=0,s=i.length,o;t?o=t:o=e*i[s-1];let a=0,l=s-1,u;for(;a<=l;)if(r=Math.floor(a+(l-a)/2),u=i[r]-o,u<0)a=r+1;else if(u>0)l=r-1;else{l=r;break}if(r=l,i[r]===o)return r/(s-1);let h=i[r],f=i[r+1]-h,d=(o-h)/f;return(r+d)/(s-1)}getTangent(e,t){let r=e-1e-4,s=e+1e-4;r<0&&(r=0),s>1&&(s=1);let o=this.getPoint(r),a=this.getPoint(s),l=t||(o.isVector2?new Se:new V);return l.copy(a).sub(o).normalize(),l}getTangentAt(e,t){let i=this.getUtoTmapping(e);return this.getTangent(i,t)}computeFrenetFrames(e,t=!1){let i=new V,r=[],s=[],o=[],a=new V,l=new Mt;for(let d=0;d<=e;d++){let m=d/e;r[d]=this.getTangentAt(m,new V)}s[0]=new V,o[0]=new V;let u=Number.MAX_VALUE,h=Math.abs(r[0].x),c=Math.abs(r[0].y),f=Math.abs(r[0].z);h<=u&&(u=h,i.set(1,0,0)),c<=u&&(u=c,i.set(0,1,0)),f<=u&&i.set(0,0,1),a.crossVectors(r[0],i).normalize(),s[0].crossVectors(r[0],a),o[0].crossVectors(r[0],s[0]);for(let d=1;d<=e;d++){if(s[d]=s[d-1].clone(),o[d]=o[d-1].clone(),a.crossVectors(r[d-1],r[d]),a.length()>Number.EPSILON){a.normalize();let m=Math.acos(Ke(r[d-1].dot(r[d]),-1,1));s[d].applyMatrix4(l.makeRotationAxis(a,m))}o[d].crossVectors(r[d],s[d])}if(t===!0){let d=Math.acos(Ke(s[0].dot(s[e]),-1,1));d/=e,r[0].dot(a.crossVectors(s[0],s[e]))>0&&(d=-d);for(let m=1;m<=e;m++)s[m].applyMatrix4(l.makeRotationAxis(r[m],d*m)),o[m].crossVectors(r[m],s[m])}return{tangents:r,normals:s,binormals:o}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}},oo=class extends An{constructor(e=0,t=0,i=1,r=1,s=0,o=Math.PI*2,a=!1,l=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=t,this.xRadius=i,this.yRadius=r,this.aStartAngle=s,this.aEndAngle=o,this.aClockwise=a,this.aRotation=l}getPoint(e,t=new Se){let i=t,r=Math.PI*2,s=this.aEndAngle-this.aStartAngle,o=Math.abs(s)<Number.EPSILON;for(;s<0;)s+=r;for(;s>r;)s-=r;s<Number.EPSILON&&(o?s=0:s=r),this.aClockwise===!0&&!o&&(s===r?s=-r:s=s-r);let a=this.aStartAngle+e*s,l=this.aX+this.xRadius*Math.cos(a),u=this.aY+this.yRadius*Math.sin(a);if(this.aRotation!==0){let h=Math.cos(this.aRotation),c=Math.sin(this.aRotation),f=l-this.aX,d=u-this.aY;l=f*h-d*c+this.aX,u=f*c+d*h+this.aY}return i.set(l,u)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){let e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}},ou=class extends oo{constructor(e,t,i,r,s,o){super(e,t,i,i,r,s,o),this.isArcCurve=!0,this.type="ArcCurve"}};function jp(){let n=0,e=0,t=0,i=0;function r(s,o,a,l){n=s,e=a,t=-3*s+3*o-2*a-l,i=2*s-2*o+a+l}return{initCatmullRom:function(s,o,a,l,u){r(o,a,u*(a-s),u*(l-o))},initNonuniformCatmullRom:function(s,o,a,l,u,h,c){let f=(o-s)/u-(a-s)/(u+h)+(a-o)/h,d=(a-o)/h-(l-o)/(h+c)+(l-a)/c;f*=h,d*=h,r(o,a,f,d)},calc:function(s){let o=s*s,a=o*s;return n+e*s+t*o+i*a}}}var Wc=new V,vp=new jp,xp=new jp,yp=new jp,au=class extends An{constructor(e=[],t=!1,i="centripetal",r=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=t,this.curveType=i,this.tension=r}getPoint(e,t=new V){let i=t,r=this.points,s=r.length,o=(s-(this.closed?0:1))*e,a=Math.floor(o),l=o-a;this.closed?a+=a>0?0:(Math.floor(Math.abs(a)/s)+1)*s:l===0&&a===s-1&&(a=s-2,l=1);let u,h;this.closed||a>0?u=r[(a-1)%s]:(Wc.subVectors(r[0],r[1]).add(r[0]),u=Wc);let c=r[a%s],f=r[(a+1)%s];if(this.closed||a+2<s?h=r[(a+2)%s]:(Wc.subVectors(r[s-1],r[s-2]).add(r[s-1]),h=Wc),this.curveType==="centripetal"||this.curveType==="chordal"){let d=this.curveType==="chordal"?.5:.25,m=Math.pow(u.distanceToSquared(c),d),x=Math.pow(c.distanceToSquared(f),d),y=Math.pow(f.distanceToSquared(h),d);x<1e-4&&(x=1),m<1e-4&&(m=x),y<1e-4&&(y=x),vp.initNonuniformCatmullRom(u.x,c.x,f.x,h.x,m,x,y),xp.initNonuniformCatmullRom(u.y,c.y,f.y,h.y,m,x,y),yp.initNonuniformCatmullRom(u.z,c.z,f.z,h.z,m,x,y)}else this.curveType==="catmullrom"&&(vp.initCatmullRom(u.x,c.x,f.x,h.x,this.tension),xp.initCatmullRom(u.y,c.y,f.y,h.y,this.tension),yp.initCatmullRom(u.z,c.z,f.z,h.z,this.tension));return i.set(vp.calc(l),xp.calc(l),yp.calc(l)),i}copy(e){super.copy(e),this.points=[];for(let t=0,i=e.points.length;t<i;t++){let r=e.points[t];this.points.push(r.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,i=this.points.length;t<i;t++){let r=this.points[t];e.points.push(r.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,i=e.points.length;t<i;t++){let r=e.points[t];this.points.push(new V().fromArray(r))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}};function Ex(n,e,t,i,r){let s=(i-e)*.5,o=(r-t)*.5,a=n*n,l=n*a;return(2*t-2*i+s+o)*l+(-3*t+3*i-2*s-o)*a+s*n+t}function o1(n,e){let t=1-n;return t*t*e}function a1(n,e){return 2*(1-n)*n*e}function l1(n,e){return n*n*e}function ya(n,e,t,i){return o1(n,e)+a1(n,t)+l1(n,i)}function c1(n,e){let t=1-n;return t*t*t*e}function u1(n,e){let t=1-n;return 3*t*t*n*e}function h1(n,e){return 3*(1-n)*n*n*e}function f1(n,e){return n*n*n*e}function _a(n,e,t,i,r){return c1(n,e)+u1(n,t)+h1(n,i)+f1(n,r)}var Fa=class extends An{constructor(e=new Se,t=new Se,i=new Se,r=new Se){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=t,this.v2=i,this.v3=r}getPoint(e,t=new Se){let i=t,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(_a(e,r.x,s.x,o.x,a.x),_a(e,r.y,s.y,o.y,a.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},lu=class extends An{constructor(e=new V,t=new V,i=new V,r=new V){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=t,this.v2=i,this.v3=r}getPoint(e,t=new V){let i=t,r=this.v0,s=this.v1,o=this.v2,a=this.v3;return i.set(_a(e,r.x,s.x,o.x,a.x),_a(e,r.y,s.y,o.y,a.y),_a(e,r.z,s.z,o.z,a.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Oa=class extends An{constructor(e=new Se,t=new Se){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=t}getPoint(e,t=new Se){let i=t;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new Se){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},cu=class extends An{constructor(e=new V,t=new V){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=t}getPoint(e,t=new V){let i=t;return e===1?i.copy(this.v2):(i.copy(this.v2).sub(this.v1),i.multiplyScalar(e).add(this.v1)),i}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new V){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Ba=class extends An{constructor(e=new Se,t=new Se,i=new Se){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=t,this.v2=i}getPoint(e,t=new Se){let i=t,r=this.v0,s=this.v1,o=this.v2;return i.set(ya(e,r.x,s.x,o.x),ya(e,r.y,s.y,o.y)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},uu=class extends An{constructor(e=new V,t=new V,i=new V){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=t,this.v2=i}getPoint(e,t=new V){let i=t,r=this.v0,s=this.v1,o=this.v2;return i.set(ya(e,r.x,s.x,o.x),ya(e,r.y,s.y,o.y),ya(e,r.z,s.z,o.z)),i}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},ka=class extends An{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,t=new Se){let i=t,r=this.points,s=(r.length-1)*e,o=Math.floor(s),a=s-o,l=r[o===0?o:o-1],u=r[o],h=r[o>r.length-2?r.length-1:o+1],c=r[o>r.length-3?r.length-1:o+2];return i.set(Ex(a,l.x,u.x,h.x,c.x),Ex(a,l.y,u.y,h.y,c.y)),i}copy(e){super.copy(e),this.points=[];for(let t=0,i=e.points.length;t<i;t++){let r=e.points[t];this.points.push(r.clone())}return this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,i=this.points.length;t<i;t++){let r=this.points[t];e.points.push(r.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,i=e.points.length;t<i;t++){let r=e.points[t];this.points.push(new Se().fromArray(r))}return this}},Tx=Object.freeze({__proto__:null,ArcCurve:ou,CatmullRomCurve3:au,CubicBezierCurve:Fa,CubicBezierCurve3:lu,EllipseCurve:oo,LineCurve:Oa,LineCurve3:cu,QuadraticBezierCurve:Ba,QuadraticBezierCurve3:uu,SplineCurve:ka}),hu=class extends An{constructor(){super(),this.type="CurvePath",this.curves=[],this.autoClose=!1}add(e){this.curves.push(e)}closePath(){let e=this.curves[0].getPoint(0),t=this.curves[this.curves.length-1].getPoint(1);if(!e.equals(t)){let i=e.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new Tx[i](t,e))}return this}getPoint(e,t){let i=e*this.getLength(),r=this.getCurveLengths(),s=0;for(;s<r.length;){if(r[s]>=i){let o=r[s]-i,a=this.curves[s],l=a.getLength(),u=l===0?0:1-o/l;return a.getPointAt(u,t)}s++}return null}getLength(){let e=this.getCurveLengths();return e[e.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;let e=[],t=0;for(let i=0,r=this.curves.length;i<r;i++)t+=this.curves[i].getLength(),e.push(t);return this.cacheLengths=e,e}getSpacedPoints(e=40){let t=[];for(let i=0;i<=e;i++)t.push(this.getPoint(i/e));return this.autoClose&&t.push(t[0]),t}getPoints(e=12){let t=[],i;for(let r=0,s=this.curves;r<s.length;r++){let o=s[r],a=o.isEllipseCurve?e*2:o.isLineCurve||o.isLineCurve3?1:o.isSplineCurve?e*o.points.length:e,l=o.getPoints(a);for(let u=0;u<l.length;u++){let h=l[u];i&&i.equals(h)||(t.push(h),i=h)}}return this.autoClose&&t.length>1&&!t[t.length-1].equals(t[0])&&t.push(t[0]),t}copy(e){super.copy(e),this.curves=[];for(let t=0,i=e.curves.length;t<i;t++){let r=e.curves[t];this.curves.push(r.clone())}return this.autoClose=e.autoClose,this}toJSON(){let e=super.toJSON();e.autoClose=this.autoClose,e.curves=[];for(let t=0,i=this.curves.length;t<i;t++){let r=this.curves[t];e.curves.push(r.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.autoClose=e.autoClose,this.curves=[];for(let t=0,i=e.curves.length;t<i;t++){let r=e.curves[t];this.curves.push(new Tx[r.type]().fromJSON(r))}return this}},$r=class extends hu{constructor(e){super(),this.type="Path",this.currentPoint=new Se,e&&this.setFromPoints(e)}setFromPoints(e){this.moveTo(e[0].x,e[0].y);for(let t=1,i=e.length;t<i;t++)this.lineTo(e[t].x,e[t].y);return this}moveTo(e,t){return this.currentPoint.set(e,t),this}lineTo(e,t){let i=new Oa(this.currentPoint.clone(),new Se(e,t));return this.curves.push(i),this.currentPoint.set(e,t),this}quadraticCurveTo(e,t,i,r){let s=new Ba(this.currentPoint.clone(),new Se(e,t),new Se(i,r));return this.curves.push(s),this.currentPoint.set(i,r),this}bezierCurveTo(e,t,i,r,s,o){let a=new Fa(this.currentPoint.clone(),new Se(e,t),new Se(i,r),new Se(s,o));return this.curves.push(a),this.currentPoint.set(s,o),this}splineThru(e){let t=[this.currentPoint.clone()].concat(e),i=new ka(t);return this.curves.push(i),this.currentPoint.copy(e[e.length-1]),this}arc(e,t,i,r,s,o){let a=this.currentPoint.x,l=this.currentPoint.y;return this.absarc(e+a,t+l,i,r,s,o),this}absarc(e,t,i,r,s,o){return this.absellipse(e,t,i,i,r,s,o),this}ellipse(e,t,i,r,s,o,a,l){let u=this.currentPoint.x,h=this.currentPoint.y;return this.absellipse(e+u,t+h,i,r,s,o,a,l),this}absellipse(e,t,i,r,s,o,a,l){let u=new oo(e,t,i,r,s,o,a,l);if(this.curves.length>0){let c=u.getPoint(0);c.equals(this.currentPoint)||this.lineTo(c.x,c.y)}this.curves.push(u);let h=u.getPoint(1);return this.currentPoint.copy(h),this}copy(e){return super.copy(e),this.currentPoint.copy(e.currentPoint),this}toJSON(){let e=super.toJSON();return e.currentPoint=this.currentPoint.toArray(),e}fromJSON(e){return super.fromJSON(e),this.currentPoint.fromArray(e.currentPoint),this}},Zr=class extends $r{constructor(e){super(e),this.uuid=po(),this.type="Shape",this.holes=[]}getPointsHoles(e){let t=[];for(let i=0,r=this.holes.length;i<r;i++)t[i]=this.holes[i].getPoints(e);return t}extractPoints(e){return{shape:this.getPoints(e),holes:this.getPointsHoles(e)}}copy(e){super.copy(e),this.holes=[];for(let t=0,i=e.holes.length;t<i;t++){let r=e.holes[t];this.holes.push(r.clone())}return this}toJSON(){let e=super.toJSON();e.uuid=this.uuid,e.holes=[];for(let t=0,i=this.holes.length;t<i;t++){let r=this.holes[t];e.holes.push(r.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.uuid=e.uuid,this.holes=[];for(let t=0,i=e.holes.length;t<i;t++){let r=e.holes[t];this.holes.push(new $r().fromJSON(r))}return this}};function d1(n,e,t=2){let i=e&&e.length,r=i?e[0]*t:n.length,s=wy(n,0,r,t,!0),o=[];if(!s||s.next===s.prev)return o;let a,l,u;if(i&&(s=x1(n,e,s,t)),n.length>80*t){a=1/0,l=1/0;let h=-1/0,c=-1/0;for(let f=t;f<r;f+=t){let d=n[f],m=n[f+1];d<a&&(a=d),m<l&&(l=m),d>h&&(h=d),m>c&&(c=m)}u=Math.max(h-a,c-l),u=u!==0?32767/u:0}return za(s,o,t,a,l,u,0),o}function wy(n,e,t,i,r){let s;if(r===R1(n,e,t,i)>0)for(let o=e;o<t;o+=i)s=Ax(o/i|0,n[o],n[o+1],s);else for(let o=t-i;o>=e;o-=i)s=Ax(o/i|0,n[o],n[o+1],s);return s&&ao(s,s.next)&&(Ha(s),s=s.next),s}function Jr(n,e){if(!n)return n;e||(e=n);let t=n,i;do if(i=!1,!t.steiner&&(ao(t,t.next)||St(t.prev,t,t.next)===0)){if(Ha(t),t=e=t.prev,t===t.next)break;i=!0}else t=t.next;while(i||t!==e);return e}function za(n,e,t,i,r,s,o){if(!n)return;!o&&s&&w1(n,i,r,s);let a=n;for(;n.prev!==n.next;){let l=n.prev,u=n.next;if(s?m1(n,i,r,s):p1(n)){e.push(l.i,n.i,u.i),Ha(n),n=u.next,a=u.next;continue}if(n=u,n===a){o?o===1?(n=g1(Jr(n),e),za(n,e,t,i,r,s,2)):o===2&&v1(n,e,t,i,r,s):za(Jr(n),e,t,i,r,s,1);break}}}function p1(n){let e=n.prev,t=n,i=n.next;if(St(e,t,i)>=0)return!1;let r=e.x,s=t.x,o=i.x,a=e.y,l=t.y,u=i.y,h=Math.min(r,s,o),c=Math.min(a,l,u),f=Math.max(r,s,o),d=Math.max(a,l,u),m=i.next;for(;m!==e;){if(m.x>=h&&m.x<=f&&m.y>=c&&m.y<=d&&xa(r,a,s,l,o,u,m.x,m.y)&&St(m.prev,m,m.next)>=0)return!1;m=m.next}return!0}function m1(n,e,t,i){let r=n.prev,s=n,o=n.next;if(St(r,s,o)>=0)return!1;let a=r.x,l=s.x,u=o.x,h=r.y,c=s.y,f=o.y,d=Math.min(a,l,u),m=Math.min(h,c,f),x=Math.max(a,l,u),y=Math.max(h,c,f),p=Ap(d,m,e,t,i),_=Ap(x,y,e,t,i),g=n.prevZ,v=n.nextZ;for(;g&&g.z>=p&&v&&v.z<=_;){if(g.x>=d&&g.x<=x&&g.y>=m&&g.y<=y&&g!==r&&g!==o&&xa(a,h,l,c,u,f,g.x,g.y)&&St(g.prev,g,g.next)>=0||(g=g.prevZ,v.x>=d&&v.x<=x&&v.y>=m&&v.y<=y&&v!==r&&v!==o&&xa(a,h,l,c,u,f,v.x,v.y)&&St(v.prev,v,v.next)>=0))return!1;v=v.nextZ}for(;g&&g.z>=p;){if(g.x>=d&&g.x<=x&&g.y>=m&&g.y<=y&&g!==r&&g!==o&&xa(a,h,l,c,u,f,g.x,g.y)&&St(g.prev,g,g.next)>=0)return!1;g=g.prevZ}for(;v&&v.z<=_;){if(v.x>=d&&v.x<=x&&v.y>=m&&v.y<=y&&v!==r&&v!==o&&xa(a,h,l,c,u,f,v.x,v.y)&&St(v.prev,v,v.next)>=0)return!1;v=v.nextZ}return!0}function g1(n,e){let t=n;do{let i=t.prev,r=t.next.next;!ao(i,r)&&Ty(i,t,t.next,r)&&Va(i,r)&&Va(r,i)&&(e.push(i.i,t.i,r.i),Ha(t),Ha(t.next),t=n=r),t=t.next}while(t!==n);return Jr(t)}function v1(n,e,t,i,r,s){let o=n;do{let a=o.next.next;for(;a!==o.prev;){if(o.i!==a.i&&A1(o,a)){let l=Ay(o,a);o=Jr(o,o.next),l=Jr(l,l.next),za(o,e,t,i,r,s,0),za(l,e,t,i,r,s,0);return}a=a.next}o=o.next}while(o!==n)}function x1(n,e,t,i){let r=[];for(let s=0,o=e.length;s<o;s++){let a=e[s]*i,l=s<o-1?e[s+1]*i:n.length,u=wy(n,a,l,i,!1);u===u.next&&(u.steiner=!0),r.push(T1(u))}r.sort(y1);for(let s=0;s<r.length;s++)t=_1(r[s],t);return t}function y1(n,e){let t=n.x-e.x;if(t===0&&(t=n.y-e.y,t===0)){let i=(n.next.y-n.y)/(n.next.x-n.x),r=(e.next.y-e.y)/(e.next.x-e.x);t=i-r}return t}function _1(n,e){let t=S1(n,e);if(!t)return e;let i=Ay(t,n);return Jr(i,i.next),Jr(t,t.next)}function S1(n,e){let t=e,i=n.x,r=n.y,s=-1/0,o;if(ao(n,t))return t;do{if(ao(n,t.next))return t.next;if(r<=t.y&&r>=t.next.y&&t.next.y!==t.y){let c=t.x+(r-t.y)*(t.next.x-t.x)/(t.next.y-t.y);if(c<=i&&c>s&&(s=c,o=t.x<t.next.x?t:t.next,c===i))return o}t=t.next}while(t!==e);if(!o)return null;let a=o,l=o.x,u=o.y,h=1/0;t=o;do{if(i>=t.x&&t.x>=l&&i!==t.x&&Ey(r<u?i:s,r,l,u,r<u?s:i,r,t.x,t.y)){let c=Math.abs(r-t.y)/(i-t.x);Va(t,n)&&(c<h||c===h&&(t.x>o.x||t.x===o.x&&M1(o,t)))&&(o=t,h=c)}t=t.next}while(t!==a);return o}function M1(n,e){return St(n.prev,n,e.prev)<0&&St(e.next,n,n.next)<0}function w1(n,e,t,i){let r=n;do r.z===0&&(r.z=Ap(r.x,r.y,e,t,i)),r.prevZ=r.prev,r.nextZ=r.next,r=r.next;while(r!==n);r.prevZ.nextZ=null,r.prevZ=null,E1(r)}function E1(n){let e,t=1;do{let i=n,r;n=null;let s=null;for(e=0;i;){e++;let o=i,a=0;for(let u=0;u<t&&(a++,o=o.nextZ,!!o);u++);let l=t;for(;a>0||l>0&&o;)a!==0&&(l===0||!o||i.z<=o.z)?(r=i,i=i.nextZ,a--):(r=o,o=o.nextZ,l--),s?s.nextZ=r:n=r,r.prevZ=s,s=r;i=o}s.nextZ=null,t*=2}while(e>1);return n}function Ap(n,e,t,i,r){return n=(n-t)*r|0,e=(e-i)*r|0,n=(n|n<<8)&16711935,n=(n|n<<4)&252645135,n=(n|n<<2)&858993459,n=(n|n<<1)&1431655765,e=(e|e<<8)&16711935,e=(e|e<<4)&252645135,e=(e|e<<2)&858993459,e=(e|e<<1)&1431655765,n|e<<1}function T1(n){let e=n,t=n;do(e.x<t.x||e.x===t.x&&e.y<t.y)&&(t=e),e=e.next;while(e!==n);return t}function Ey(n,e,t,i,r,s,o,a){return(r-o)*(e-a)>=(n-o)*(s-a)&&(n-o)*(i-a)>=(t-o)*(e-a)&&(t-o)*(s-a)>=(r-o)*(i-a)}function xa(n,e,t,i,r,s,o,a){return!(n===o&&e===a)&&Ey(n,e,t,i,r,s,o,a)}function A1(n,e){return n.next.i!==e.i&&n.prev.i!==e.i&&!b1(n,e)&&(Va(n,e)&&Va(e,n)&&C1(n,e)&&(St(n.prev,n,e.prev)||St(n,e.prev,e))||ao(n,e)&&St(n.prev,n,n.next)>0&&St(e.prev,e,e.next)>0)}function St(n,e,t){return(e.y-n.y)*(t.x-e.x)-(e.x-n.x)*(t.y-e.y)}function ao(n,e){return n.x===e.x&&n.y===e.y}function Ty(n,e,t,i){let r=Yc(St(n,e,t)),s=Yc(St(n,e,i)),o=Yc(St(t,i,n)),a=Yc(St(t,i,e));return!!(r!==s&&o!==a||r===0&&Xc(n,t,e)||s===0&&Xc(n,i,e)||o===0&&Xc(t,n,i)||a===0&&Xc(t,e,i))}function Xc(n,e,t){return e.x<=Math.max(n.x,t.x)&&e.x>=Math.min(n.x,t.x)&&e.y<=Math.max(n.y,t.y)&&e.y>=Math.min(n.y,t.y)}function Yc(n){return n>0?1:n<0?-1:0}function b1(n,e){let t=n;do{if(t.i!==n.i&&t.next.i!==n.i&&t.i!==e.i&&t.next.i!==e.i&&Ty(t,t.next,n,e))return!0;t=t.next}while(t!==n);return!1}function Va(n,e){return St(n.prev,n,n.next)<0?St(n,e,n.next)>=0&&St(n,n.prev,e)>=0:St(n,e,n.prev)<0||St(n,n.next,e)<0}function C1(n,e){let t=n,i=!1,r=(n.x+e.x)/2,s=(n.y+e.y)/2;do t.y>s!=t.next.y>s&&t.next.y!==t.y&&r<(t.next.x-t.x)*(s-t.y)/(t.next.y-t.y)+t.x&&(i=!i),t=t.next;while(t!==n);return i}function Ay(n,e){let t=bp(n.i,n.x,n.y),i=bp(e.i,e.x,e.y),r=n.next,s=e.prev;return n.next=e,e.prev=n,t.next=r,r.prev=t,i.next=t,t.prev=i,s.next=i,i.prev=s,i}function Ax(n,e,t,i){let r=bp(n,e,t);return i?(r.next=i.next,r.prev=i,i.next.prev=r,i.next=r):(r.prev=r,r.next=r),r}function Ha(n){n.next.prev=n.prev,n.prev.next=n.next,n.prevZ&&(n.prevZ.nextZ=n.nextZ),n.nextZ&&(n.nextZ.prevZ=n.prevZ)}function bp(n,e,t){return{i:n,x:e,y:t,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:!1}}function R1(n,e,t,i){let r=0;for(let s=e,o=t-i;s<t;s+=i)r+=(n[o]-n[s])*(n[s+1]+n[o+1]),o=s;return r}var Cp=class{static triangulate(e,t,i=2){return d1(e,t,i)}},Ks=class n{static area(e){let t=e.length,i=0;for(let r=t-1,s=0;s<t;r=s++)i+=e[r].x*e[s].y-e[s].x*e[r].y;return i*.5}static isClockWise(e){return n.area(e)<0}static triangulateShape(e,t){let i=[],r=[],s=[];bx(e),Cx(i,e);let o=e.length;t.forEach(bx);for(let l=0;l<t.length;l++)r.push(o),o+=t[l].length,Cx(i,t[l]);let a=Cp.triangulate(i,r);for(let l=0;l<a.length;l+=3)s.push(a.slice(l,l+3));return s}};function bx(n){let e=n.length;e>2&&n[e-1].equals(n[0])&&n.pop()}function Cx(n,e){for(let t=0;t<e.length;t++)n.push(e[t].x),n.push(e[t].y)}var Kr=class n extends ti{constructor(e=1,t=1,i=1,r=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:i,heightSegments:r};let s=e/2,o=t/2,a=Math.floor(i),l=Math.floor(r),u=a+1,h=l+1,c=e/a,f=t/l,d=[],m=[],x=[],y=[];for(let p=0;p<h;p++){let _=p*f-o;for(let g=0;g<u;g++){let v=g*c-s;m.push(v,-_,0),x.push(0,0,1),y.push(g/a),y.push(1-p/l)}}for(let p=0;p<l;p++)for(let _=0;_<a;_++){let g=_+u*p,v=_+u*(p+1),M=_+1+u*(p+1),S=_+1+u*p;d.push(g,v,S),d.push(v,M,S)}this.setIndex(d),this.setAttribute("position",new $t(m,3)),this.setAttribute("normal",new $t(x,3)),this.setAttribute("uv",new $t(y,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new n(e.width,e.height,e.widthSegments,e.heightSegments)}};var Ga=class n extends ti{constructor(e=new Zr([new Se(0,.5),new Se(-.5,-.5),new Se(.5,-.5)]),t=12){super(),this.type="ShapeGeometry",this.parameters={shapes:e,curveSegments:t};let i=[],r=[],s=[],o=[],a=0,l=0;if(Array.isArray(e)===!1)u(e);else for(let h=0;h<e.length;h++)u(e[h]),this.addGroup(a,l,h),a+=l,l=0;this.setIndex(i),this.setAttribute("position",new $t(r,3)),this.setAttribute("normal",new $t(s,3)),this.setAttribute("uv",new $t(o,2));function u(h){let c=r.length/3,f=h.extractPoints(t),d=f.shape,m=f.holes;Ks.isClockWise(d)===!1&&(d=d.reverse());for(let y=0,p=m.length;y<p;y++){let _=m[y];Ks.isClockWise(_)===!0&&(m[y]=_.reverse())}let x=Ks.triangulateShape(d,m);for(let y=0,p=m.length;y<p;y++){let _=m[y];d=d.concat(_)}for(let y=0,p=d.length;y<p;y++){let _=d[y];r.push(_.x,_.y,0),s.push(0,0,1),o.push(_.x,_.y)}for(let y=0,p=x.length;y<p;y++){let _=x[y],g=_[0]+c,v=_[1]+c,M=_[2]+c;i.push(g,v,M),l+=3}}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON(),t=this.parameters.shapes;return P1(t,e)}static fromJSON(e,t){let i=[];for(let r=0,s=e.shapes.length;r<s;r++){let o=t[e.shapes[r]];i.push(o)}return new n(i,e.curveSegments)}};function P1(n,e){if(e.shapes=[],Array.isArray(n))for(let t=0,i=n.length;t<i;t++){let r=n[t];e.shapes.push(r.uuid)}else e.shapes.push(n.uuid);return e}var Wa=class extends Oi{constructor(e){super(),this.isShadowMaterial=!0,this.type="ShadowMaterial",this.color=new je(0),this.transparent=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.fog=e.fog,this}};var Xa=class extends Oi{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new je(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new je(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=$p,this.normalScale=new Se(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new ei,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}};var fu=class extends Oi{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=cy,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},du=class extends Oi{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function qc(n,e){return!n||n.constructor===e?n:typeof e.BYTES_PER_ELEMENT=="number"?new e(n):Array.prototype.slice.call(n)}function I1(n){return ArrayBuffer.isView(n)&&!(n instanceof DataView)}var Qr=class{constructor(e,t,i,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r!==void 0?r:new t.constructor(i),this.sampleValues=t,this.valueSize=i,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,i=this._cachedIndex,r=t[i],s=t[i-1];e:{t:{let o;n:{i:if(!(e<r)){for(let a=i+2;;){if(r===void 0){if(e<s)break i;return i=t.length,this._cachedIndex=i,this.copySampleValue_(i-1)}if(i===a)break;if(s=r,r=t[++i],e<r)break t}o=t.length;break n}if(!(e>=s)){let a=t[1];e<a&&(i=2,s=a);for(let l=i-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===l)break;if(r=s,s=t[--i-1],e>=s)break t}o=i,i=0;break n}break e}for(;i<o;){let a=i+o>>>1;e<t[a]?o=a:i=a+1}if(r=t[i],s=t[i-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return i=t.length,this._cachedIndex=i,this.copySampleValue_(i-1)}this._cachedIndex=i,this.intervalChanged_(i,s,r)}return this.interpolate_(i,s,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,i=this.sampleValues,r=this.valueSize,s=e*r;for(let o=0;o!==r;++o)t[o]=i[s+o];return t}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},pu=class extends Qr{constructor(e,t,i,r){super(e,t,i,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:Sp,endingEnd:Sp}}intervalChanged_(e,t,i){let r=this.parameterPositions,s=e-2,o=e+1,a=r[s],l=r[o];if(a===void 0)switch(this.getSettings_().endingStart){case Mp:s=e,a=2*t-i;break;case wp:s=r.length-2,a=t+r[s]-r[s+1];break;default:s=e,a=i}if(l===void 0)switch(this.getSettings_().endingEnd){case Mp:o=e,l=2*i-t;break;case wp:o=1,l=i+r[1]-r[0];break;default:o=e-1,l=t}let u=(i-t)*.5,h=this.valueSize;this._weightPrev=u/(t-a),this._weightNext=u/(l-i),this._offsetPrev=s*h,this._offsetNext=o*h}interpolate_(e,t,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,u=l-a,h=this._offsetPrev,c=this._offsetNext,f=this._weightPrev,d=this._weightNext,m=(i-t)/(r-t),x=m*m,y=x*m,p=-f*y+2*f*x-f*m,_=(1+f)*y+(-1.5-2*f)*x+(-.5+f)*m+1,g=(-1-d)*y+(1.5+d)*x+.5*m,v=d*y-d*x;for(let M=0;M!==a;++M)s[M]=p*o[h+M]+_*o[u+M]+g*o[l+M]+v*o[c+M];return s}},mu=class extends Qr{constructor(e,t,i,r){super(e,t,i,r)}interpolate_(e,t,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,u=l-a,h=(i-t)/(r-t),c=1-h;for(let f=0;f!==a;++f)s[f]=o[u+f]*c+o[l+f]*h;return s}},gu=class extends Qr{constructor(e,t,i,r){super(e,t,i,r)}interpolate_(e){return this.copySampleValue_(e-1)}},bn=class{constructor(e,t,i,r){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=qc(t,this.TimeBufferType),this.values=qc(i,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,i;if(t.toJSON!==this.toJSON)i=t.toJSON(e);else{i={name:e.name,times:qc(e.times,Array),values:qc(e.values,Array)};let r=e.getInterpolation();r!==e.DefaultInterpolation&&(i.interpolation=r)}return i.type=e.ValueTypeName,i}InterpolantFactoryMethodDiscrete(e){return new gu(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new mu(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new pu(this.times,this.values,this.getValueSize(),e)}setInterpolation(e){let t;switch(e){case Sa:t=this.InterpolantFactoryMethodDiscrete;break;case jc:t=this.InterpolantFactoryMethodLinear;break;case $c:t=this.InterpolantFactoryMethodSmooth;break}if(t===void 0){let i="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(i);return console.warn("THREE.KeyframeTrack:",i),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Sa;case this.InterpolantFactoryMethodLinear:return jc;case this.InterpolantFactoryMethodSmooth:return $c}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let i=0,r=t.length;i!==r;++i)t[i]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let i=0,r=t.length;i!==r;++i)t[i]*=e}return this}trim(e,t){let i=this.times,r=i.length,s=0,o=r-1;for(;s!==r&&i[s]<e;)++s;for(;o!==-1&&i[o]>t;)--o;if(++o,s!==0||o!==r){s>=o&&(o=Math.max(o,1),s=o-1);let a=this.getValueSize();this.times=i.slice(s,o),this.values=this.values.slice(s*a,o*a)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(console.error("THREE.KeyframeTrack: Invalid value size in track.",this),e=!1);let i=this.times,r=this.values,s=i.length;s===0&&(console.error("THREE.KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==s;a++){let l=i[a];if(typeof l=="number"&&isNaN(l)){console.error("THREE.KeyframeTrack: Time is not a valid number.",this,a,l),e=!1;break}if(o!==null&&o>l){console.error("THREE.KeyframeTrack: Out of order keys.",this,a,l,o),e=!1;break}o=l}if(r!==void 0&&I1(r))for(let a=0,l=r.length;a!==l;++a){let u=r[a];if(isNaN(u)){console.error("THREE.KeyframeTrack: Value is not a valid number.",this,a,u),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),i=this.getValueSize(),r=this.getInterpolation()===$c,s=e.length-1,o=1;for(let a=1;a<s;++a){let l=!1,u=e[a],h=e[a+1];if(u!==h&&(a!==1||u!==e[0]))if(r)l=!0;else{let c=a*i,f=c-i,d=c+i;for(let m=0;m!==i;++m){let x=t[c+m];if(x!==t[f+m]||x!==t[d+m]){l=!0;break}}}if(l){if(a!==o){e[o]=e[a];let c=a*i,f=o*i;for(let d=0;d!==i;++d)t[f+d]=t[c+d]}++o}}if(s>0){e[o]=e[s];for(let a=s*i,l=o*i,u=0;u!==i;++u)t[l+u]=t[a+u];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=t.slice(0,o*i)):(this.times=e,this.values=t),this}clone(){let e=this.times.slice(),t=this.values.slice(),i=this.constructor,r=new i(this.name,e,t);return r.createInterpolant=this.createInterpolant,r}};bn.prototype.ValueTypeName="";bn.prototype.TimeBufferType=Float32Array;bn.prototype.ValueBufferType=Float32Array;bn.prototype.DefaultInterpolation=jc;var yr=class extends bn{constructor(e,t,i){super(e,t,i)}};yr.prototype.ValueTypeName="bool";yr.prototype.ValueBufferType=Array;yr.prototype.DefaultInterpolation=Sa;yr.prototype.InterpolantFactoryMethodLinear=void 0;yr.prototype.InterpolantFactoryMethodSmooth=void 0;var vu=class extends bn{constructor(e,t,i,r){super(e,t,i,r)}};vu.prototype.ValueTypeName="color";var xu=class extends bn{constructor(e,t,i,r){super(e,t,i,r)}};xu.prototype.ValueTypeName="number";var yu=class extends Qr{constructor(e,t,i,r){super(e,t,i,r)}interpolate_(e,t,i,r){let s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=(i-t)/(r-t),u=e*a;for(let h=u+a;u!==h;u+=4)Fi.slerpFlat(s,0,o,u-a,o,u,l);return s}},Ya=class extends bn{constructor(e,t,i,r){super(e,t,i,r)}InterpolantFactoryMethodLinear(e){return new yu(this.times,this.values,this.getValueSize(),e)}};Ya.prototype.ValueTypeName="quaternion";Ya.prototype.InterpolantFactoryMethodSmooth=void 0;var _r=class extends bn{constructor(e,t,i){super(e,t,i)}};_r.prototype.ValueTypeName="string";_r.prototype.ValueBufferType=Array;_r.prototype.DefaultInterpolation=Sa;_r.prototype.InterpolantFactoryMethodLinear=void 0;_r.prototype.InterpolantFactoryMethodSmooth=void 0;var _u=class extends bn{constructor(e,t,i,r){super(e,t,i,r)}};_u.prototype.ValueTypeName="vector";var Su=class{constructor(e,t,i){let r=this,s=!1,o=0,a=0,l,u=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=i,this.abortController=new AbortController,this.itemStart=function(h){a++,s===!1&&r.onStart!==void 0&&r.onStart(h,o,a),s=!0},this.itemEnd=function(h){o++,r.onProgress!==void 0&&r.onProgress(h,o,a),o===a&&(s=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(h){r.onError!==void 0&&r.onError(h)},this.resolveURL=function(h){return l?l(h):h},this.setURLModifier=function(h){return l=h,this},this.addHandler=function(h,c){return u.push(h,c),this},this.removeHandler=function(h){let c=u.indexOf(h);return c!==-1&&u.splice(c,2),this},this.getHandler=function(h){for(let c=0,f=u.length;c<f;c+=2){let d=u[c],m=u[c+1];if(d.global&&(d.lastIndex=0),d.test(h))return m}return null},this.abort=function(){return this.abortController.abort(),this.abortController=new AbortController,this}}},by=new Su,Mu=class{constructor(e){this.manager=e!==void 0?e:by,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(e,t){let i=this;return new Promise(function(r,s){i.load(e,r,t,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};Mu.DEFAULT_MATERIAL_NAME="__DEFAULT";var qa=class extends Zt{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new je(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(t.object.target=this.target.uuid),t}},$a=class extends qa{constructor(e,t,i){super(e,i),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(Zt.DEFAULT_UP),this.updateMatrix(),this.groundColor=new je(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}},_p=new Mt,Rx=new V,Px=new V,Rp=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Se(512,512),this.mapType=ii,this.map=null,this.mapPass=null,this.matrix=new Mt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new so,this._frameExtents=new Se(1,1),this._viewportCount=1,this._viewports=[new wt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera,i=this.matrix;Rx.setFromMatrixPosition(e.matrixWorld),t.position.copy(Rx),Px.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(Px),t.updateMatrixWorld(),_p.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(_p,t.coordinateSystem,t.reversedDepth),t.reversedDepth?i.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):i.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),i.multiply(_p)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}};var jr=class extends Pa{constructor(e=-1,t=1,i=1,r=-1,s=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=i,this.bottom=r,this.near=s,this.far=o,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,i,r,s,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=i,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,r=(this.top+this.bottom)/2,s=i-e,o=i+e,a=r+t,l=r-t;if(this.view!==null&&this.view.enabled){let u=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=u*this.view.offsetX,o=s+u*this.view.width,a-=h*this.view.offsetY,l=a-h*this.view.height}this.projectionMatrix.makeOrthographic(s,o,a,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},Pp=class extends Rp{constructor(){super(new jr(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},lo=class extends qa{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(Zt.DEFAULT_UP),this.updateMatrix(),this.target=new Zt,this.shadow=new Pp}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}};var wu=class extends dn{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}};var em="\\[\\]\\.:\\/",L1=new RegExp("["+em+"]","g"),tm="[^"+em+"]",D1="[^"+em.replace("\\.","")+"]",N1=/((?:WC+[\/:])*)/.source.replace("WC",tm),U1=/(WCOD+)?/.source.replace("WCOD",D1),F1=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",tm),O1=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",tm),B1=new RegExp("^"+N1+U1+F1+O1+"$"),k1=["material","materials","bones","map"],Ip=class{constructor(e,t,i){let r=i||pt.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,r)}getValue(e,t){this.bind();let i=this._targetGroup.nCachedObjects_,r=this._bindings[i];r!==void 0&&r.getValue(e,t)}setValue(e,t){let i=this._bindings;for(let r=this._targetGroup.nCachedObjects_,s=i.length;r!==s;++r)i[r].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,i=e.length;t!==i;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,i=e.length;t!==i;++t)e[t].unbind()}},pt=class n{constructor(e,t,i){this.path=t,this.parsedPath=i||n.parseTrackName(t),this.node=n.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,i){return e&&e.isAnimationObjectGroup?new n.Composite(e,t,i):new n(e,t,i)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(L1,"")}static parseTrackName(e){let t=B1.exec(e);if(t===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let i={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},r=i.nodeName&&i.nodeName.lastIndexOf(".");if(r!==void 0&&r!==-1){let s=i.nodeName.substring(r+1);k1.indexOf(s)!==-1&&(i.nodeName=i.nodeName.substring(0,r),i.objectName=s)}if(i.propertyName===null||i.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return i}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let i=e.skeleton.getBoneByName(t);if(i!==void 0)return i}if(e.children){let i=function(s){for(let o=0;o<s.length;o++){let a=s[o];if(a.name===t||a.uuid===t)return a;let l=i(a.children);if(l)return l}return null},r=i(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)e[t++]=i[r]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let i=this.resolvedProperty;for(let r=0,s=i.length;r!==s;++r)i[r]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node,t=this.parsedPath,i=t.objectName,r=t.propertyName,s=t.propertyIndex;if(e||(e=n.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){console.warn("THREE.PropertyBinding: No target node found for track: "+this.path+".");return}if(i){let u=t.objectIndex;switch(i){case"materials":if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let h=0;h<e.length;h++)if(e[h].name===u){u=h;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){console.error("THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[i]===void 0){console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[i]}if(u!==void 0){if(e[u]===void 0){console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[u]}}let o=e[r];if(o===void 0){let u=t.nodeName;console.error("THREE.PropertyBinding: Trying to update property for track: "+u+"."+r+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?a=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(s!==void 0){if(r==="morphTargetInfluences"){if(!e.geometry){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}l=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=s}else o.fromArray!==void 0&&o.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(l=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=r;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};pt.Composite=Ip;pt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};pt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};pt.prototype.GetterByBindingType=[pt.prototype._getValue_direct,pt.prototype._getValue_array,pt.prototype._getValue_arrayElement,pt.prototype._getValue_toArray];pt.prototype.SetterByBindingTypeAndVersioning=[[pt.prototype._setValue_direct,pt.prototype._setValue_direct_setNeedsUpdate,pt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[pt.prototype._setValue_array,pt.prototype._setValue_array_setNeedsUpdate,pt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[pt.prototype._setValue_arrayElement,pt.prototype._setValue_arrayElement_setNeedsUpdate,pt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[pt.prototype._setValue_fromArray,pt.prototype._setValue_fromArray_setNeedsUpdate,pt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var Hb=new Float32Array(1);var Ix=new Mt,Za=class{constructor(e,t,i=0,r=1/0){this.ray=new Aa(e,t),this.near=i,this.far=r,this.camera=null,this.layers=new no,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,t){this.ray.set(e,t)}setFromCamera(e,t){t.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(t).sub(this.ray.origin).normalize(),this.camera=t):t.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,(t.near+t.far)/(t.near-t.far)).unproject(t),this.ray.direction.set(0,0,-1).transformDirection(t.matrixWorld),this.camera=t):console.error("THREE.Raycaster: Unsupported camera type: "+t.type)}setFromXRController(e){return Ix.identity().extractRotation(e.matrixWorld),this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(Ix),this}intersectObject(e,t=!0,i=[]){return Lp(e,this,i,t),i.sort(Lx),i}intersectObjects(e,t=!0,i=[]){for(let r=0,s=e.length;r<s;r++)Lp(e[r],this,i,t);return i.sort(Lx),i}};function Lx(n,e){return n.distance-e.distance}function Lp(n,e,t,i){let r=!0;if(n.layers.test(e.layers)&&n.raycast(e,t)===!1&&(r=!1),r===!0&&i===!0){let s=n.children;for(let o=0,a=s.length;o<a;o++)Lp(s[o],e,t,!0)}}function nm(n,e,t,i){let r=z1(i);switch(t){case Wp:return n*e;case Yp:return n*e/r.components*r.byteLength;case Bu:return n*e/r.components*r.byteLength;case qp:return n*e*2/r.components*r.byteLength;case ku:return n*e*2/r.components*r.byteLength;case Xp:return n*e*3/r.components*r.byteLength;case zn:return n*e*4/r.components*r.byteLength;case zu:return n*e*4/r.components*r.byteLength;case Qa:case ja:return Math.floor((n+3)/4)*Math.floor((e+3)/4)*8;case el:case tl:return Math.floor((n+3)/4)*Math.floor((e+3)/4)*16;case Hu:case Wu:return Math.max(n,16)*Math.max(e,8)/4;case Vu:case Gu:return Math.max(n,8)*Math.max(e,8)/2;case Xu:case Yu:return Math.floor((n+3)/4)*Math.floor((e+3)/4)*8;case qu:return Math.floor((n+3)/4)*Math.floor((e+3)/4)*16;case $u:return Math.floor((n+3)/4)*Math.floor((e+3)/4)*16;case Zu:return Math.floor((n+4)/5)*Math.floor((e+3)/4)*16;case Ju:return Math.floor((n+4)/5)*Math.floor((e+4)/5)*16;case Ku:return Math.floor((n+5)/6)*Math.floor((e+4)/5)*16;case Qu:return Math.floor((n+5)/6)*Math.floor((e+5)/6)*16;case ju:return Math.floor((n+7)/8)*Math.floor((e+4)/5)*16;case eh:return Math.floor((n+7)/8)*Math.floor((e+5)/6)*16;case th:return Math.floor((n+7)/8)*Math.floor((e+7)/8)*16;case nh:return Math.floor((n+9)/10)*Math.floor((e+4)/5)*16;case ih:return Math.floor((n+9)/10)*Math.floor((e+5)/6)*16;case rh:return Math.floor((n+9)/10)*Math.floor((e+7)/8)*16;case sh:return Math.floor((n+9)/10)*Math.floor((e+9)/10)*16;case oh:return Math.floor((n+11)/12)*Math.floor((e+9)/10)*16;case ah:return Math.floor((n+11)/12)*Math.floor((e+11)/12)*16;case lh:case ch:case uh:return Math.ceil(n/4)*Math.ceil(e/4)*16;case hh:case fh:return Math.ceil(n/4)*Math.ceil(e/4)*8;case dh:case ph:return Math.ceil(n/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function z1(n){switch(n){case ii:case zp:return{byteLength:1,components:1};case co:case Vp:case uo:return{byteLength:2,components:1};case Fu:case Ou:return{byteLength:2,components:4};case Mr:case Uu:case pi:return{byteLength:4,components:1};case Hp:case Gp:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${n}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"180"}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="180");function Ky(){let n=null,e=!1,t=null,i=null;function r(s,o){t(s,o),i=n.requestAnimationFrame(r)}return{start:function(){e!==!0&&t!==null&&(i=n.requestAnimationFrame(r),e=!0)},stop:function(){n.cancelAnimationFrame(i),e=!1},setAnimationLoop:function(s){t=s},setContext:function(s){n=s}}}function H1(n){let e=new WeakMap;function t(a,l){let u=a.array,h=a.usage,c=u.byteLength,f=n.createBuffer();n.bindBuffer(l,f),n.bufferData(l,u,h),a.onUploadCallback();let d;if(u instanceof Float32Array)d=n.FLOAT;else if(typeof Float16Array<"u"&&u instanceof Float16Array)d=n.HALF_FLOAT;else if(u instanceof Uint16Array)a.isFloat16BufferAttribute?d=n.HALF_FLOAT:d=n.UNSIGNED_SHORT;else if(u instanceof Int16Array)d=n.SHORT;else if(u instanceof Uint32Array)d=n.UNSIGNED_INT;else if(u instanceof Int32Array)d=n.INT;else if(u instanceof Int8Array)d=n.BYTE;else if(u instanceof Uint8Array)d=n.UNSIGNED_BYTE;else if(u instanceof Uint8ClampedArray)d=n.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+u);return{buffer:f,type:d,bytesPerElement:u.BYTES_PER_ELEMENT,version:a.version,size:c}}function i(a,l,u){let h=l.array,c=l.updateRanges;if(n.bindBuffer(u,a),c.length===0)n.bufferSubData(u,0,h);else{c.sort((d,m)=>d.start-m.start);let f=0;for(let d=1;d<c.length;d++){let m=c[f],x=c[d];x.start<=m.start+m.count+1?m.count=Math.max(m.count,x.start+x.count-m.start):(++f,c[f]=x)}c.length=f+1;for(let d=0,m=c.length;d<m;d++){let x=c[d];n.bufferSubData(u,x.start*h.BYTES_PER_ELEMENT,h,x.start,x.count)}l.clearUpdateRanges()}l.onUploadCallback()}function r(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function s(a){a.isInterleavedBufferAttribute&&(a=a.data);let l=e.get(a);l&&(n.deleteBuffer(l.buffer),e.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){let h=e.get(a);(!h||h.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}let u=e.get(a);if(u===void 0)e.set(a,t(a,l));else if(u.version<a.version){if(u.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(u.buffer,a,l),u.version=a.version}}return{get:r,remove:s,update:o}}var G1=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,W1=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,X1=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Y1=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,q1=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,$1=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Z1=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,J1=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,K1=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,Q1=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,j1=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,ew=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,tw=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,nw=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,iw=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,rw=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,sw=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,ow=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,aw=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,lw=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,cw=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,uw=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,hw=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,fw=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,dw=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,pw=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,mw=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,gw=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,vw=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,xw=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,yw="gl_FragColor = linearToOutputTexel( gl_FragColor );",_w=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,Sw=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,Mw=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,ww=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,Ew=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,Tw=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,Aw=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,bw=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Cw=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Rw=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Pw=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,Iw=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Lw=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Dw=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,Nw=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,Uw=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,Fw=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Ow=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Bw=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,kw=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,zw=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,Vw=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,Hw=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,Gw=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,Ww=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Xw=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Yw=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,qw=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,$w=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,Zw=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Jw=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Kw=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,Qw=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,jw=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,eE=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,tE=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,nE=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,iE=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,rE=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,sE=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,oE=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,aE=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,lE=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,cE=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,uE=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,hE=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,fE=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,dE=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,pE=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,mE=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,gE=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,vE=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,xE=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,yE=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,_E=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,SE=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,ME=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,wE=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,EE=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		float depth = unpackRGBAToDepth( texture2D( depths, uv ) );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			return step( depth, compare );
		#else
			return step( compare, depth );
		#endif
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow( sampler2D shadow, vec2 uv, float compare ) {
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			float hard_shadow = step( distribution.x, compare );
		#else
			float hard_shadow = step( compare, distribution.x );
		#endif
		if ( hard_shadow != 1.0 ) {
			float distance = compare - distribution.x;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,TE=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,AE=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,bE=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,CE=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,RE=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,PE=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,IE=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,LE=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,DE=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,NE=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,UE=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,FE=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,OE=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,BE=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,kE=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,zE=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,VE=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,HE=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,GE=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,WE=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,XE=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,YE=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,qE=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,$E=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,ZE=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,JE=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,KE=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,QE=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,jE=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,eT=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,tT=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,nT=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,iT=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,rT=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,sT=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,oT=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,aT=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,lT=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,cT=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,uT=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,hT=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,fT=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,dT=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,pT=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,mT=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,gT=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,vT=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,xT=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,yT=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,_T=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,ST=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Ze={alphahash_fragment:G1,alphahash_pars_fragment:W1,alphamap_fragment:X1,alphamap_pars_fragment:Y1,alphatest_fragment:q1,alphatest_pars_fragment:$1,aomap_fragment:Z1,aomap_pars_fragment:J1,batching_pars_vertex:K1,batching_vertex:Q1,begin_vertex:j1,beginnormal_vertex:ew,bsdfs:tw,iridescence_fragment:nw,bumpmap_pars_fragment:iw,clipping_planes_fragment:rw,clipping_planes_pars_fragment:sw,clipping_planes_pars_vertex:ow,clipping_planes_vertex:aw,color_fragment:lw,color_pars_fragment:cw,color_pars_vertex:uw,color_vertex:hw,common:fw,cube_uv_reflection_fragment:dw,defaultnormal_vertex:pw,displacementmap_pars_vertex:mw,displacementmap_vertex:gw,emissivemap_fragment:vw,emissivemap_pars_fragment:xw,colorspace_fragment:yw,colorspace_pars_fragment:_w,envmap_fragment:Sw,envmap_common_pars_fragment:Mw,envmap_pars_fragment:ww,envmap_pars_vertex:Ew,envmap_physical_pars_fragment:Uw,envmap_vertex:Tw,fog_vertex:Aw,fog_pars_vertex:bw,fog_fragment:Cw,fog_pars_fragment:Rw,gradientmap_pars_fragment:Pw,lightmap_pars_fragment:Iw,lights_lambert_fragment:Lw,lights_lambert_pars_fragment:Dw,lights_pars_begin:Nw,lights_toon_fragment:Fw,lights_toon_pars_fragment:Ow,lights_phong_fragment:Bw,lights_phong_pars_fragment:kw,lights_physical_fragment:zw,lights_physical_pars_fragment:Vw,lights_fragment_begin:Hw,lights_fragment_maps:Gw,lights_fragment_end:Ww,logdepthbuf_fragment:Xw,logdepthbuf_pars_fragment:Yw,logdepthbuf_pars_vertex:qw,logdepthbuf_vertex:$w,map_fragment:Zw,map_pars_fragment:Jw,map_particle_fragment:Kw,map_particle_pars_fragment:Qw,metalnessmap_fragment:jw,metalnessmap_pars_fragment:eE,morphinstance_vertex:tE,morphcolor_vertex:nE,morphnormal_vertex:iE,morphtarget_pars_vertex:rE,morphtarget_vertex:sE,normal_fragment_begin:oE,normal_fragment_maps:aE,normal_pars_fragment:lE,normal_pars_vertex:cE,normal_vertex:uE,normalmap_pars_fragment:hE,clearcoat_normal_fragment_begin:fE,clearcoat_normal_fragment_maps:dE,clearcoat_pars_fragment:pE,iridescence_pars_fragment:mE,opaque_fragment:gE,packing:vE,premultiplied_alpha_fragment:xE,project_vertex:yE,dithering_fragment:_E,dithering_pars_fragment:SE,roughnessmap_fragment:ME,roughnessmap_pars_fragment:wE,shadowmap_pars_fragment:EE,shadowmap_pars_vertex:TE,shadowmap_vertex:AE,shadowmask_pars_fragment:bE,skinbase_vertex:CE,skinning_pars_vertex:RE,skinning_vertex:PE,skinnormal_vertex:IE,specularmap_fragment:LE,specularmap_pars_fragment:DE,tonemapping_fragment:NE,tonemapping_pars_fragment:UE,transmission_fragment:FE,transmission_pars_fragment:OE,uv_pars_fragment:BE,uv_pars_vertex:kE,uv_vertex:zE,worldpos_vertex:VE,background_vert:HE,background_frag:GE,backgroundCube_vert:WE,backgroundCube_frag:XE,cube_vert:YE,cube_frag:qE,depth_vert:$E,depth_frag:ZE,distanceRGBA_vert:JE,distanceRGBA_frag:KE,equirect_vert:QE,equirect_frag:jE,linedashed_vert:eT,linedashed_frag:tT,meshbasic_vert:nT,meshbasic_frag:iT,meshlambert_vert:rT,meshlambert_frag:sT,meshmatcap_vert:oT,meshmatcap_frag:aT,meshnormal_vert:lT,meshnormal_frag:cT,meshphong_vert:uT,meshphong_frag:hT,meshphysical_vert:fT,meshphysical_frag:dT,meshtoon_vert:pT,meshtoon_frag:mT,points_vert:gT,points_frag:vT,shadow_vert:xT,shadow_frag:yT,sprite_vert:_T,sprite_frag:ST},xe={common:{diffuse:{value:new je(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new $e},alphaMap:{value:null},alphaMapTransform:{value:new $e},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new $e}},envmap:{envMap:{value:null},envMapRotation:{value:new $e},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new $e}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new $e}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new $e},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new $e},normalScale:{value:new Se(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new $e},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new $e}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new $e}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new $e}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new je(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new je(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new $e},alphaTest:{value:0},uvTransform:{value:new $e}},sprite:{diffuse:{value:new je(16777215)},opacity:{value:1},center:{value:new Se(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new $e},alphaMap:{value:null},alphaMapTransform:{value:new $e},alphaTest:{value:0}}},mi={basic:{uniforms:Jt([xe.common,xe.specularmap,xe.envmap,xe.aomap,xe.lightmap,xe.fog]),vertexShader:Ze.meshbasic_vert,fragmentShader:Ze.meshbasic_frag},lambert:{uniforms:Jt([xe.common,xe.specularmap,xe.envmap,xe.aomap,xe.lightmap,xe.emissivemap,xe.bumpmap,xe.normalmap,xe.displacementmap,xe.fog,xe.lights,{emissive:{value:new je(0)}}]),vertexShader:Ze.meshlambert_vert,fragmentShader:Ze.meshlambert_frag},phong:{uniforms:Jt([xe.common,xe.specularmap,xe.envmap,xe.aomap,xe.lightmap,xe.emissivemap,xe.bumpmap,xe.normalmap,xe.displacementmap,xe.fog,xe.lights,{emissive:{value:new je(0)},specular:{value:new je(1118481)},shininess:{value:30}}]),vertexShader:Ze.meshphong_vert,fragmentShader:Ze.meshphong_frag},standard:{uniforms:Jt([xe.common,xe.envmap,xe.aomap,xe.lightmap,xe.emissivemap,xe.bumpmap,xe.normalmap,xe.displacementmap,xe.roughnessmap,xe.metalnessmap,xe.fog,xe.lights,{emissive:{value:new je(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Ze.meshphysical_vert,fragmentShader:Ze.meshphysical_frag},toon:{uniforms:Jt([xe.common,xe.aomap,xe.lightmap,xe.emissivemap,xe.bumpmap,xe.normalmap,xe.displacementmap,xe.gradientmap,xe.fog,xe.lights,{emissive:{value:new je(0)}}]),vertexShader:Ze.meshtoon_vert,fragmentShader:Ze.meshtoon_frag},matcap:{uniforms:Jt([xe.common,xe.bumpmap,xe.normalmap,xe.displacementmap,xe.fog,{matcap:{value:null}}]),vertexShader:Ze.meshmatcap_vert,fragmentShader:Ze.meshmatcap_frag},points:{uniforms:Jt([xe.points,xe.fog]),vertexShader:Ze.points_vert,fragmentShader:Ze.points_frag},dashed:{uniforms:Jt([xe.common,xe.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Ze.linedashed_vert,fragmentShader:Ze.linedashed_frag},depth:{uniforms:Jt([xe.common,xe.displacementmap]),vertexShader:Ze.depth_vert,fragmentShader:Ze.depth_frag},normal:{uniforms:Jt([xe.common,xe.bumpmap,xe.normalmap,xe.displacementmap,{opacity:{value:1}}]),vertexShader:Ze.meshnormal_vert,fragmentShader:Ze.meshnormal_frag},sprite:{uniforms:Jt([xe.sprite,xe.fog]),vertexShader:Ze.sprite_vert,fragmentShader:Ze.sprite_frag},background:{uniforms:{uvTransform:{value:new $e},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Ze.background_vert,fragmentShader:Ze.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new $e}},vertexShader:Ze.backgroundCube_vert,fragmentShader:Ze.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Ze.cube_vert,fragmentShader:Ze.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Ze.equirect_vert,fragmentShader:Ze.equirect_frag},distanceRGBA:{uniforms:Jt([xe.common,xe.displacementmap,{referencePosition:{value:new V},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Ze.distanceRGBA_vert,fragmentShader:Ze.distanceRGBA_frag},shadow:{uniforms:Jt([xe.lights,xe.fog,{color:{value:new je(0)},opacity:{value:1}}]),vertexShader:Ze.shadow_vert,fragmentShader:Ze.shadow_frag}};mi.physical={uniforms:Jt([mi.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new $e},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new $e},clearcoatNormalScale:{value:new Se(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new $e},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new $e},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new $e},sheen:{value:0},sheenColor:{value:new je(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new $e},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new $e},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new $e},transmissionSamplerSize:{value:new Se},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new $e},attenuationDistance:{value:0},attenuationColor:{value:new je(0)},specularColor:{value:new je(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new $e},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new $e},anisotropyVector:{value:new Se},anisotropyMap:{value:null},anisotropyMapTransform:{value:new $e}}]),vertexShader:Ze.meshphysical_vert,fragmentShader:Ze.meshphysical_frag};var mh={r:0,b:0,g:0},is=new ei,MT=new Mt;function wT(n,e,t,i,r,s,o){let a=new je(0),l=s===!0?0:1,u,h,c=null,f=0,d=null;function m(g){let v=g.isScene===!0?g.background:null;return v&&v.isTexture&&(v=(g.backgroundBlurriness>0?t:e).get(v)),v}function x(g){let v=!1,M=m(g);M===null?p(a,l):M&&M.isColor&&(p(M,1),v=!0);let S=n.xr.getEnvironmentBlendMode();S==="additive"?i.buffers.color.setClear(0,0,0,1,o):S==="alpha-blend"&&i.buffers.color.setClear(0,0,0,0,o),(n.autoClear||v)&&(i.buffers.depth.setTest(!0),i.buffers.depth.setMask(!0),i.buffers.color.setMask(!0),n.clear(n.autoClearColor,n.autoClearDepth,n.autoClearStencil))}function y(g,v){let M=m(v);M&&(M.isCubeTexture||M.mapping===Ja)?(h===void 0&&(h=new rn(new io(1,1,1),new ni({name:"BackgroundCubeMaterial",uniforms:ns(mi.backgroundCube.uniforms),vertexShader:mi.backgroundCube.vertexShader,fragmentShader:mi.backgroundCube.fragmentShader,side:sn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(S,E,A){this.matrixWorld.copyPosition(A.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),r.update(h)),is.copy(v.backgroundRotation),is.x*=-1,is.y*=-1,is.z*=-1,M.isCubeTexture&&M.isRenderTargetTexture===!1&&(is.y*=-1,is.z*=-1),h.material.uniforms.envMap.value=M,h.material.uniforms.flipEnvMap.value=M.isCubeTexture&&M.isRenderTargetTexture===!1?-1:1,h.material.uniforms.backgroundBlurriness.value=v.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,h.material.uniforms.backgroundRotation.value.setFromMatrix4(MT.makeRotationFromEuler(is)),h.material.toneMapped=tt.getTransfer(M.colorSpace)!==st,(c!==M||f!==M.version||d!==n.toneMapping)&&(h.material.needsUpdate=!0,c=M,f=M.version,d=n.toneMapping),h.layers.enableAll(),g.unshift(h,h.geometry,h.material,0,0,null)):M&&M.isTexture&&(u===void 0&&(u=new rn(new Kr(2,2),new ni({name:"BackgroundMaterial",uniforms:ns(mi.background.uniforms),vertexShader:mi.background.vertexShader,fragmentShader:mi.background.fragmentShader,side:Ni,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),u.geometry.deleteAttribute("normal"),Object.defineProperty(u.material,"map",{get:function(){return this.uniforms.t2D.value}}),r.update(u)),u.material.uniforms.t2D.value=M,u.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,u.material.toneMapped=tt.getTransfer(M.colorSpace)!==st,M.matrixAutoUpdate===!0&&M.updateMatrix(),u.material.uniforms.uvTransform.value.copy(M.matrix),(c!==M||f!==M.version||d!==n.toneMapping)&&(u.material.needsUpdate=!0,c=M,f=M.version,d=n.toneMapping),u.layers.enableAll(),g.unshift(u,u.geometry,u.material,0,0,null))}function p(g,v){g.getRGB(mh,Qp(n)),i.buffers.color.setClear(mh.r,mh.g,mh.b,v,o)}function _(){h!==void 0&&(h.geometry.dispose(),h.material.dispose(),h=void 0),u!==void 0&&(u.geometry.dispose(),u.material.dispose(),u=void 0)}return{getClearColor:function(){return a},setClearColor:function(g,v=1){a.set(g),l=v,p(a,l)},getClearAlpha:function(){return l},setClearAlpha:function(g){l=g,p(a,l)},render:x,addToRenderList:y,dispose:_}}function ET(n,e){let t=n.getParameter(n.MAX_VERTEX_ATTRIBS),i={},r=f(null),s=r,o=!1;function a(T,b,L,D,F){let U=!1,O=c(D,L,b);s!==O&&(s=O,u(s.object)),U=d(T,D,L,F),U&&m(T,D,L,F),F!==null&&e.update(F,n.ELEMENT_ARRAY_BUFFER),(U||o)&&(o=!1,v(T,b,L,D),F!==null&&n.bindBuffer(n.ELEMENT_ARRAY_BUFFER,e.get(F).buffer))}function l(){return n.createVertexArray()}function u(T){return n.bindVertexArray(T)}function h(T){return n.deleteVertexArray(T)}function c(T,b,L){let D=L.wireframe===!0,F=i[T.id];F===void 0&&(F={},i[T.id]=F);let U=F[b.id];U===void 0&&(U={},F[b.id]=U);let O=U[D];return O===void 0&&(O=f(l()),U[D]=O),O}function f(T){let b=[],L=[],D=[];for(let F=0;F<t;F++)b[F]=0,L[F]=0,D[F]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:b,enabledAttributes:L,attributeDivisors:D,object:T,attributes:{},index:null}}function d(T,b,L,D){let F=s.attributes,U=b.attributes,O=0,Z=L.getAttributes();for(let W in Z)if(Z[W].location>=0){let re=F[W],de=U[W];if(de===void 0&&(W==="instanceMatrix"&&T.instanceMatrix&&(de=T.instanceMatrix),W==="instanceColor"&&T.instanceColor&&(de=T.instanceColor)),re===void 0||re.attribute!==de||de&&re.data!==de.data)return!0;O++}return s.attributesNum!==O||s.index!==D}function m(T,b,L,D){let F={},U=b.attributes,O=0,Z=L.getAttributes();for(let W in Z)if(Z[W].location>=0){let re=U[W];re===void 0&&(W==="instanceMatrix"&&T.instanceMatrix&&(re=T.instanceMatrix),W==="instanceColor"&&T.instanceColor&&(re=T.instanceColor));let de={};de.attribute=re,re&&re.data&&(de.data=re.data),F[W]=de,O++}s.attributes=F,s.attributesNum=O,s.index=D}function x(){let T=s.newAttributes;for(let b=0,L=T.length;b<L;b++)T[b]=0}function y(T){p(T,0)}function p(T,b){let L=s.newAttributes,D=s.enabledAttributes,F=s.attributeDivisors;L[T]=1,D[T]===0&&(n.enableVertexAttribArray(T),D[T]=1),F[T]!==b&&(n.vertexAttribDivisor(T,b),F[T]=b)}function _(){let T=s.newAttributes,b=s.enabledAttributes;for(let L=0,D=b.length;L<D;L++)b[L]!==T[L]&&(n.disableVertexAttribArray(L),b[L]=0)}function g(T,b,L,D,F,U,O){O===!0?n.vertexAttribIPointer(T,b,L,F,U):n.vertexAttribPointer(T,b,L,D,F,U)}function v(T,b,L,D){x();let F=D.attributes,U=L.getAttributes(),O=b.defaultAttributeValues;for(let Z in U){let W=U[Z];if(W.location>=0){let ne=F[Z];if(ne===void 0&&(Z==="instanceMatrix"&&T.instanceMatrix&&(ne=T.instanceMatrix),Z==="instanceColor"&&T.instanceColor&&(ne=T.instanceColor)),ne!==void 0){let re=ne.normalized,de=ne.itemSize,Ue=e.get(ne);if(Ue===void 0)continue;let He=Ue.buffer,Ee=Ue.type,Ve=Ue.bytesPerElement,q=Ee===n.INT||Ee===n.UNSIGNED_INT||ne.gpuType===Uu;if(ne.isInterleavedBufferAttribute){let ee=ne.data,pe=ee.stride,Te=ne.offset;if(ee.isInstancedInterleavedBuffer){for(let ve=0;ve<W.locationSize;ve++)p(W.location+ve,ee.meshPerAttribute);T.isInstancedMesh!==!0&&D._maxInstanceCount===void 0&&(D._maxInstanceCount=ee.meshPerAttribute*ee.count)}else for(let ve=0;ve<W.locationSize;ve++)y(W.location+ve);n.bindBuffer(n.ARRAY_BUFFER,He);for(let ve=0;ve<W.locationSize;ve++)g(W.location+ve,de/W.locationSize,Ee,re,pe*Ve,(Te+de/W.locationSize*ve)*Ve,q)}else{if(ne.isInstancedBufferAttribute){for(let ee=0;ee<W.locationSize;ee++)p(W.location+ee,ne.meshPerAttribute);T.isInstancedMesh!==!0&&D._maxInstanceCount===void 0&&(D._maxInstanceCount=ne.meshPerAttribute*ne.count)}else for(let ee=0;ee<W.locationSize;ee++)y(W.location+ee);n.bindBuffer(n.ARRAY_BUFFER,He);for(let ee=0;ee<W.locationSize;ee++)g(W.location+ee,de/W.locationSize,Ee,re,de*Ve,de/W.locationSize*ee*Ve,q)}}else if(O!==void 0){let re=O[Z];if(re!==void 0)switch(re.length){case 2:n.vertexAttrib2fv(W.location,re);break;case 3:n.vertexAttrib3fv(W.location,re);break;case 4:n.vertexAttrib4fv(W.location,re);break;default:n.vertexAttrib1fv(W.location,re)}}}}_()}function M(){A();for(let T in i){let b=i[T];for(let L in b){let D=b[L];for(let F in D)h(D[F].object),delete D[F];delete b[L]}delete i[T]}}function S(T){if(i[T.id]===void 0)return;let b=i[T.id];for(let L in b){let D=b[L];for(let F in D)h(D[F].object),delete D[F];delete b[L]}delete i[T.id]}function E(T){for(let b in i){let L=i[b];if(L[T.id]===void 0)continue;let D=L[T.id];for(let F in D)h(D[F].object),delete D[F];delete L[T.id]}}function A(){w(),o=!0,s!==r&&(s=r,u(s.object))}function w(){r.geometry=null,r.program=null,r.wireframe=!1}return{setup:a,reset:A,resetDefaultState:w,dispose:M,releaseStatesOfGeometry:S,releaseStatesOfProgram:E,initAttributes:x,enableAttribute:y,disableUnusedAttributes:_}}function TT(n,e,t){let i;function r(u){i=u}function s(u,h){n.drawArrays(i,u,h),t.update(h,i,1)}function o(u,h,c){c!==0&&(n.drawArraysInstanced(i,u,h,c),t.update(h,i,c))}function a(u,h,c){if(c===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,u,0,h,0,c);let d=0;for(let m=0;m<c;m++)d+=h[m];t.update(d,i,1)}function l(u,h,c,f){if(c===0)return;let d=e.get("WEBGL_multi_draw");if(d===null)for(let m=0;m<u.length;m++)o(u[m],h[m],f[m]);else{d.multiDrawArraysInstancedWEBGL(i,u,0,h,0,f,0,c);let m=0;for(let x=0;x<c;x++)m+=h[x]*f[x];t.update(m,i,1)}}this.setMode=r,this.render=s,this.renderInstances=o,this.renderMultiDraw=a,this.renderMultiDrawInstances=l}function AT(n,e,t,i){let r;function s(){if(r!==void 0)return r;if(e.has("EXT_texture_filter_anisotropic")===!0){let E=e.get("EXT_texture_filter_anisotropic");r=n.getParameter(E.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else r=0;return r}function o(E){return!(E!==zn&&i.convert(E)!==n.getParameter(n.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(E){let A=E===uo&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(E!==ii&&i.convert(E)!==n.getParameter(n.IMPLEMENTATION_COLOR_READ_TYPE)&&E!==pi&&!A)}function l(E){if(E==="highp"){if(n.getShaderPrecisionFormat(n.VERTEX_SHADER,n.HIGH_FLOAT).precision>0&&n.getShaderPrecisionFormat(n.FRAGMENT_SHADER,n.HIGH_FLOAT).precision>0)return"highp";E="mediump"}return E==="mediump"&&n.getShaderPrecisionFormat(n.VERTEX_SHADER,n.MEDIUM_FLOAT).precision>0&&n.getShaderPrecisionFormat(n.FRAGMENT_SHADER,n.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let u=t.precision!==void 0?t.precision:"highp",h=l(u);h!==u&&(console.warn("THREE.WebGLRenderer:",u,"not supported, using",h,"instead."),u=h);let c=t.logarithmicDepthBuffer===!0,f=t.reversedDepthBuffer===!0&&e.has("EXT_clip_control"),d=n.getParameter(n.MAX_TEXTURE_IMAGE_UNITS),m=n.getParameter(n.MAX_VERTEX_TEXTURE_IMAGE_UNITS),x=n.getParameter(n.MAX_TEXTURE_SIZE),y=n.getParameter(n.MAX_CUBE_MAP_TEXTURE_SIZE),p=n.getParameter(n.MAX_VERTEX_ATTRIBS),_=n.getParameter(n.MAX_VERTEX_UNIFORM_VECTORS),g=n.getParameter(n.MAX_VARYING_VECTORS),v=n.getParameter(n.MAX_FRAGMENT_UNIFORM_VECTORS),M=m>0,S=n.getParameter(n.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:u,logarithmicDepthBuffer:c,reversedDepthBuffer:f,maxTextures:d,maxVertexTextures:m,maxTextureSize:x,maxCubemapSize:y,maxAttributes:p,maxVertexUniforms:_,maxVaryings:g,maxFragmentUniforms:v,vertexTextures:M,maxSamples:S}}function bT(n){let e=this,t=null,i=0,r=!1,s=!1,o=new Bn,a=new $e,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(c,f){let d=c.length!==0||f||i!==0||r;return r=f,i=c.length,d},this.beginShadows=function(){s=!0,h(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(c,f){t=h(c,f,0)},this.setState=function(c,f,d){let m=c.clippingPlanes,x=c.clipIntersection,y=c.clipShadows,p=n.get(c);if(!r||m===null||m.length===0||s&&!y)s?h(null):u();else{let _=s?0:i,g=_*4,v=p.clippingState||null;l.value=v,v=h(m,f,g,d);for(let M=0;M!==g;++M)v[M]=t[M];p.clippingState=v,this.numIntersection=x?this.numPlanes:0,this.numPlanes+=_}};function u(){l.value!==t&&(l.value=t,l.needsUpdate=i>0),e.numPlanes=i,e.numIntersection=0}function h(c,f,d,m){let x=c!==null?c.length:0,y=null;if(x!==0){if(y=l.value,m!==!0||y===null){let p=d+x*4,_=f.matrixWorldInverse;a.getNormalMatrix(_),(y===null||y.length<p)&&(y=new Float32Array(p));for(let g=0,v=d;g!==x;++g,v+=4)o.copy(c[g]).applyMatrix4(_,a),o.normal.toArray(y,v),y[v+3]=o.constant}l.value=y,l.needsUpdate=!0}return e.numPlanes=x,e.numIntersection=0,y}}function CT(n){let e=new WeakMap;function t(o,a){return a===Lu?o.mapping=es:a===Du&&(o.mapping=ts),o}function i(o){if(o&&o.isTexture){let a=o.mapping;if(a===Lu||a===Du)if(e.has(o)){let l=e.get(o).texture;return t(l,o.mapping)}else{let l=o.image;if(l&&l.height>0){let u=new su(l.height);return u.fromEquirectangularTexture(n,o),e.set(o,u),o.addEventListener("dispose",r),t(u.texture,o.mapping)}else return null}}return o}function r(o){let a=o.target;a.removeEventListener("dispose",r);let l=e.get(a);l!==void 0&&(e.delete(a),l.dispose())}function s(){e=new WeakMap}return{get:i,dispose:s}}var go=4,Cy=[.125,.215,.35,.446,.526,.582],os=20,im=new jr,Ry=new je,rm=null,sm=0,om=0,am=!1,ss=(1+Math.sqrt(5))/2,mo=1/ss,Py=[new V(-ss,mo,0),new V(ss,mo,0),new V(-mo,0,ss),new V(mo,0,ss),new V(0,ss,-mo),new V(0,ss,mo),new V(-1,1,-1),new V(1,1,-1),new V(-1,1,1),new V(1,1,1)],RT=new V,xh=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,i=.1,r=100,s={}){let{size:o=256,position:a=RT}=s;rm=this._renderer.getRenderTarget(),sm=this._renderer.getActiveCubeFace(),om=this._renderer.getActiveMipmapLevel(),am=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(e,i,r,l,a),t>0&&this._blur(l,0,0,t),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Dy(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Ly(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(rm,sm,om),this._renderer.xr.enabled=am,e.scissorTest=!1,gh(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===es||e.mapping===ts?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),rm=this._renderer.getRenderTarget(),sm=this._renderer.getActiveCubeFace(),om=this._renderer.getActiveMipmapLevel(),am=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let i=t||this._allocateTargets();return this._textureToCubeUV(e,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,i={magFilter:jn,minFilter:jn,generateMipmaps:!1,type:uo,format:zn,colorSpace:qr,depthBuffer:!1},r=Iy(e,t,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Iy(e,t,i);let{_lodMax:s}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=PT(s)),this._blurMaterial=IT(s,e,t)}return r}_compileMaterial(e){let t=new rn(this._lodPlanes[0],e);this._renderer.compile(t,im)}_sceneToCubeUV(e,t,i,r,s){let l=new dn(90,1,t,i),u=[1,-1,1,1,1,1],h=[1,1,1,-1,-1,-1],c=this._renderer,f=c.autoClear,d=c.toneMapping;c.getClearColor(Ry),c.toneMapping=ki,c.autoClear=!1,c.state.buffers.depth.getReversed()&&(c.setRenderTarget(r),c.clearDepth(),c.setRenderTarget(null));let x=new ba({name:"PMREM.Background",side:sn,depthWrite:!1,depthTest:!1}),y=new rn(new io,x),p=!1,_=e.background;_?_.isColor&&(x.color.copy(_),e.background=null,p=!0):(x.color.copy(Ry),p=!0);for(let g=0;g<6;g++){let v=g%3;v===0?(l.up.set(0,u[g],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+h[g],s.y,s.z)):v===1?(l.up.set(0,0,u[g]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+h[g],s.z)):(l.up.set(0,u[g],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+h[g]));let M=this._cubeSize;gh(r,v*M,g>2?M:0,M,M),c.setRenderTarget(r),p&&c.render(y,l),c.render(e,l)}y.geometry.dispose(),y.material.dispose(),c.toneMapping=d,c.autoClear=f,e.background=_}_textureToCubeUV(e,t){let i=this._renderer,r=e.mapping===es||e.mapping===ts;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=Dy()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Ly());let s=r?this._cubemapMaterial:this._equirectMaterial,o=new rn(this._lodPlanes[0],s),a=s.uniforms;a.envMap.value=e;let l=this._cubeSize;gh(t,0,0,3*l,2*l),i.setRenderTarget(t),i.render(o,im)}_applyPMREM(e){let t=this._renderer,i=t.autoClear;t.autoClear=!1;let r=this._lodPlanes.length;for(let s=1;s<r;s++){let o=Math.sqrt(this._sigmas[s]*this._sigmas[s]-this._sigmas[s-1]*this._sigmas[s-1]),a=Py[(r-s-1)%Py.length];this._blur(e,s-1,s,o,a)}t.autoClear=i}_blur(e,t,i,r,s){let o=this._pingPongRenderTarget;this._halfBlur(e,o,t,i,r,"latitudinal",s),this._halfBlur(o,e,i,i,r,"longitudinal",s)}_halfBlur(e,t,i,r,s,o,a){let l=this._renderer,u=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");let h=3,c=new rn(this._lodPlanes[r],u),f=u.uniforms,d=this._sizeLods[i]-1,m=isFinite(s)?Math.PI/(2*d):2*Math.PI/(2*os-1),x=s/m,y=isFinite(s)?1+Math.floor(h*x):os;y>os&&console.warn(`sigmaRadians, ${s}, is too large and will clip, as it requested ${y} samples when the maximum is set to ${os}`);let p=[],_=0;for(let E=0;E<os;++E){let A=E/x,w=Math.exp(-A*A/2);p.push(w),E===0?_+=w:E<y&&(_+=2*w)}for(let E=0;E<p.length;E++)p[E]=p[E]/_;f.envMap.value=e.texture,f.samples.value=y,f.weights.value=p,f.latitudinal.value=o==="latitudinal",a&&(f.poleAxis.value=a);let{_lodMax:g}=this;f.dTheta.value=m,f.mipInt.value=g-i;let v=this._sizeLods[r],M=3*v*(r>g-go?r-g+go:0),S=4*(this._cubeSize-v);gh(t,M,S,3*v,2*v),l.setRenderTarget(t),l.render(c,im)}};function PT(n){let e=[],t=[],i=[],r=n,s=n-go+1+Cy.length;for(let o=0;o<s;o++){let a=Math.pow(2,r);t.push(a);let l=1/a;o>n-go?l=Cy[o-n+go-1]:o===0&&(l=0),i.push(l);let u=1/(a-2),h=-u,c=1+u,f=[h,h,c,h,c,c,h,h,c,c,h,c],d=6,m=6,x=3,y=2,p=1,_=new Float32Array(x*m*d),g=new Float32Array(y*m*d),v=new Float32Array(p*m*d);for(let S=0;S<d;S++){let E=S%3*2/3-1,A=S>2?0:-1,w=[E,A,0,E+2/3,A,0,E+2/3,A+1,0,E,A,0,E+2/3,A+1,0,E,A+1,0];_.set(w,x*m*S),g.set(f,y*m*S);let T=[S,S,S,S,S,S];v.set(T,p*m*S)}let M=new ti;M.setAttribute("position",new Tn(_,x)),M.setAttribute("uv",new Tn(g,y)),M.setAttribute("faceIndex",new Tn(v,p)),e.push(M),r>go&&r--}return{lodPlanes:e,sizeLods:t,sigmas:i}}function Iy(n,e,t){let i=new hi(n,e,t);return i.texture.mapping=Ja,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function gh(n,e,t,i,r){n.viewport.set(e,t,i,r),n.scissor.set(e,t,i,r)}function IT(n,e,t){let i=new Float32Array(os),r=new V(0,1,0);return new ni({name:"SphericalGaussianBlur",defines:{n:os,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${n}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:r}},vertexShader:vm(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Bi,depthTest:!1,depthWrite:!1})}function Ly(){return new ni({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:vm(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Bi,depthTest:!1,depthWrite:!1})}function Dy(){return new ni({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:vm(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Bi,depthTest:!1,depthWrite:!1})}function vm(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function LT(n){let e=new WeakMap,t=null;function i(a){if(a&&a.isTexture){let l=a.mapping,u=l===Lu||l===Du,h=l===es||l===ts;if(u||h){let c=e.get(a),f=c!==void 0?c.texture.pmremVersion:0;if(a.isRenderTargetTexture&&a.pmremVersion!==f)return t===null&&(t=new xh(n)),c=u?t.fromEquirectangular(a,c):t.fromCubemap(a,c),c.texture.pmremVersion=a.pmremVersion,e.set(a,c),c.texture;if(c!==void 0)return c.texture;{let d=a.image;return u&&d&&d.height>0||h&&d&&r(d)?(t===null&&(t=new xh(n)),c=u?t.fromEquirectangular(a):t.fromCubemap(a),c.texture.pmremVersion=a.pmremVersion,e.set(a,c),a.addEventListener("dispose",s),c.texture):null}}}return a}function r(a){let l=0,u=6;for(let h=0;h<u;h++)a[h]!==void 0&&l++;return l===u}function s(a){let l=a.target;l.removeEventListener("dispose",s);let u=e.get(l);u!==void 0&&(e.delete(l),u.dispose())}function o(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:i,dispose:o}}function DT(n){let e={};function t(i){if(e[i]!==void 0)return e[i];let r;switch(i){case"WEBGL_depth_texture":r=n.getExtension("WEBGL_depth_texture")||n.getExtension("MOZ_WEBGL_depth_texture")||n.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":r=n.getExtension("EXT_texture_filter_anisotropic")||n.getExtension("MOZ_EXT_texture_filter_anisotropic")||n.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":r=n.getExtension("WEBGL_compressed_texture_s3tc")||n.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||n.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":r=n.getExtension("WEBGL_compressed_texture_pvrtc")||n.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:r=n.getExtension(i)}return e[i]=r,r}return{has:function(i){return t(i)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(i){let r=t(i);return r===null&&js("THREE.WebGLRenderer: "+i+" extension not supported."),r}}}function NT(n,e,t,i){let r={},s=new WeakMap;function o(c){let f=c.target;f.index!==null&&e.remove(f.index);for(let m in f.attributes)e.remove(f.attributes[m]);f.removeEventListener("dispose",o),delete r[f.id];let d=s.get(f);d&&(e.remove(d),s.delete(f)),i.releaseStatesOfGeometry(f),f.isInstancedBufferGeometry===!0&&delete f._maxInstanceCount,t.memory.geometries--}function a(c,f){return r[f.id]===!0||(f.addEventListener("dispose",o),r[f.id]=!0,t.memory.geometries++),f}function l(c){let f=c.attributes;for(let d in f)e.update(f[d],n.ARRAY_BUFFER)}function u(c){let f=[],d=c.index,m=c.attributes.position,x=0;if(d!==null){let _=d.array;x=d.version;for(let g=0,v=_.length;g<v;g+=3){let M=_[g+0],S=_[g+1],E=_[g+2];f.push(M,S,S,E,E,M)}}else if(m!==void 0){let _=m.array;x=m.version;for(let g=0,v=_.length/3-1;g<v;g+=3){let M=g+0,S=g+1,E=g+2;f.push(M,S,S,E,E,M)}}else return;let y=new(Kp(f)?Ra:Ca)(f,1);y.version=x;let p=s.get(c);p&&e.remove(p),s.set(c,y)}function h(c){let f=s.get(c);if(f){let d=c.index;d!==null&&f.version<d.version&&u(c)}else u(c);return s.get(c)}return{get:a,update:l,getWireframeAttribute:h}}function UT(n,e,t){let i;function r(f){i=f}let s,o;function a(f){s=f.type,o=f.bytesPerElement}function l(f,d){n.drawElements(i,d,s,f*o),t.update(d,i,1)}function u(f,d,m){m!==0&&(n.drawElementsInstanced(i,d,s,f*o,m),t.update(d,i,m))}function h(f,d,m){if(m===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,d,0,s,f,0,m);let y=0;for(let p=0;p<m;p++)y+=d[p];t.update(y,i,1)}function c(f,d,m,x){if(m===0)return;let y=e.get("WEBGL_multi_draw");if(y===null)for(let p=0;p<f.length;p++)u(f[p]/o,d[p],x[p]);else{y.multiDrawElementsInstancedWEBGL(i,d,0,s,f,0,x,0,m);let p=0;for(let _=0;_<m;_++)p+=d[_]*x[_];t.update(p,i,1)}}this.setMode=r,this.setIndex=a,this.render=l,this.renderInstances=u,this.renderMultiDraw=h,this.renderMultiDrawInstances=c}function FT(n){let e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function i(s,o,a){switch(t.calls++,o){case n.TRIANGLES:t.triangles+=a*(s/3);break;case n.LINES:t.lines+=a*(s/2);break;case n.LINE_STRIP:t.lines+=a*(s-1);break;case n.LINE_LOOP:t.lines+=a*s;break;case n.POINTS:t.points+=a*s;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function r(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:r,update:i}}function OT(n,e,t){let i=new WeakMap,r=new wt;function s(o,a,l){let u=o.morphTargetInfluences,h=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,c=h!==void 0?h.length:0,f=i.get(a);if(f===void 0||f.count!==c){let w=function(){E.dispose(),i.delete(a),a.removeEventListener("dispose",w)};f!==void 0&&f.texture.dispose();let d=a.morphAttributes.position!==void 0,m=a.morphAttributes.normal!==void 0,x=a.morphAttributes.color!==void 0,y=a.morphAttributes.position||[],p=a.morphAttributes.normal||[],_=a.morphAttributes.color||[],g=0;d===!0&&(g=1),m===!0&&(g=2),x===!0&&(g=3);let v=a.attributes.position.count*g,M=1;v>e.maxTextureSize&&(M=Math.ceil(v/e.maxTextureSize),v=e.maxTextureSize);let S=new Float32Array(v*M*4*c),E=new Ta(S,v,M,c);E.type=pi,E.needsUpdate=!0;let A=g*4;for(let T=0;T<c;T++){let b=y[T],L=p[T],D=_[T],F=v*M*4*T;for(let U=0;U<b.count;U++){let O=U*A;d===!0&&(r.fromBufferAttribute(b,U),S[F+O+0]=r.x,S[F+O+1]=r.y,S[F+O+2]=r.z,S[F+O+3]=0),m===!0&&(r.fromBufferAttribute(L,U),S[F+O+4]=r.x,S[F+O+5]=r.y,S[F+O+6]=r.z,S[F+O+7]=0),x===!0&&(r.fromBufferAttribute(D,U),S[F+O+8]=r.x,S[F+O+9]=r.y,S[F+O+10]=r.z,S[F+O+11]=D.itemSize===4?r.w:1)}}f={count:c,texture:E,size:new Se(v,M)},i.set(a,f),a.addEventListener("dispose",w)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(n,"morphTexture",o.morphTexture,t);else{let d=0;for(let x=0;x<u.length;x++)d+=u[x];let m=a.morphTargetsRelative?1:1-d;l.getUniforms().setValue(n,"morphTargetBaseInfluence",m),l.getUniforms().setValue(n,"morphTargetInfluences",u)}l.getUniforms().setValue(n,"morphTargetsTexture",f.texture,t),l.getUniforms().setValue(n,"morphTargetsTextureSize",f.size)}return{update:s}}function BT(n,e,t,i){let r=new WeakMap;function s(l){let u=i.render.frame,h=l.geometry,c=e.get(l,h);if(r.get(c)!==u&&(e.update(c),r.set(c,u)),l.isInstancedMesh&&(l.hasEventListener("dispose",a)===!1&&l.addEventListener("dispose",a),r.get(l)!==u&&(t.update(l.instanceMatrix,n.ARRAY_BUFFER),l.instanceColor!==null&&t.update(l.instanceColor,n.ARRAY_BUFFER),r.set(l,u))),l.isSkinnedMesh){let f=l.skeleton;r.get(f)!==u&&(f.update(),r.set(f,u))}return c}function o(){r=new WeakMap}function a(l){let u=l.target;u.removeEventListener("dispose",a),t.remove(u.instanceMatrix),u.instanceColor!==null&&t.remove(u.instanceColor)}return{update:s,dispose:o}}var Qy=new pn,Ny=new Na(1,1),jy=new Ta,e_=new iu,t_=new Ia,Uy=[],Fy=[],Oy=new Float32Array(16),By=new Float32Array(9),ky=new Float32Array(4);function xo(n,e,t){let i=n[0];if(i<=0||i>0)return n;let r=e*t,s=Uy[r];if(s===void 0&&(s=new Float32Array(r),Uy[r]=s),e!==0){i.toArray(s,0);for(let o=1,a=0;o!==e;++o)a+=t,n[o].toArray(s,a)}return s}function It(n,e){if(n.length!==e.length)return!1;for(let t=0,i=n.length;t<i;t++)if(n[t]!==e[t])return!1;return!0}function Lt(n,e){for(let t=0,i=e.length;t<i;t++)n[t]=e[t]}function _h(n,e){let t=Fy[e];t===void 0&&(t=new Int32Array(e),Fy[e]=t);for(let i=0;i!==e;++i)t[i]=n.allocateTextureUnit();return t}function kT(n,e){let t=this.cache;t[0]!==e&&(n.uniform1f(this.addr,e),t[0]=e)}function zT(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(n.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(It(t,e))return;n.uniform2fv(this.addr,e),Lt(t,e)}}function VT(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(n.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(n.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(It(t,e))return;n.uniform3fv(this.addr,e),Lt(t,e)}}function HT(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(n.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(It(t,e))return;n.uniform4fv(this.addr,e),Lt(t,e)}}function GT(n,e){let t=this.cache,i=e.elements;if(i===void 0){if(It(t,e))return;n.uniformMatrix2fv(this.addr,!1,e),Lt(t,e)}else{if(It(t,i))return;ky.set(i),n.uniformMatrix2fv(this.addr,!1,ky),Lt(t,i)}}function WT(n,e){let t=this.cache,i=e.elements;if(i===void 0){if(It(t,e))return;n.uniformMatrix3fv(this.addr,!1,e),Lt(t,e)}else{if(It(t,i))return;By.set(i),n.uniformMatrix3fv(this.addr,!1,By),Lt(t,i)}}function XT(n,e){let t=this.cache,i=e.elements;if(i===void 0){if(It(t,e))return;n.uniformMatrix4fv(this.addr,!1,e),Lt(t,e)}else{if(It(t,i))return;Oy.set(i),n.uniformMatrix4fv(this.addr,!1,Oy),Lt(t,i)}}function YT(n,e){let t=this.cache;t[0]!==e&&(n.uniform1i(this.addr,e),t[0]=e)}function qT(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(n.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(It(t,e))return;n.uniform2iv(this.addr,e),Lt(t,e)}}function $T(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(n.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(It(t,e))return;n.uniform3iv(this.addr,e),Lt(t,e)}}function ZT(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(n.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(It(t,e))return;n.uniform4iv(this.addr,e),Lt(t,e)}}function JT(n,e){let t=this.cache;t[0]!==e&&(n.uniform1ui(this.addr,e),t[0]=e)}function KT(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(n.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(It(t,e))return;n.uniform2uiv(this.addr,e),Lt(t,e)}}function QT(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(n.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(It(t,e))return;n.uniform3uiv(this.addr,e),Lt(t,e)}}function jT(n,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(n.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(It(t,e))return;n.uniform4uiv(this.addr,e),Lt(t,e)}}function eA(n,e,t){let i=this.cache,r=t.allocateTextureUnit();i[0]!==r&&(n.uniform1i(this.addr,r),i[0]=r);let s;this.type===n.SAMPLER_2D_SHADOW?(Ny.compareFunction=Zp,s=Ny):s=Qy,t.setTexture2D(e||s,r)}function tA(n,e,t){let i=this.cache,r=t.allocateTextureUnit();i[0]!==r&&(n.uniform1i(this.addr,r),i[0]=r),t.setTexture3D(e||e_,r)}function nA(n,e,t){let i=this.cache,r=t.allocateTextureUnit();i[0]!==r&&(n.uniform1i(this.addr,r),i[0]=r),t.setTextureCube(e||t_,r)}function iA(n,e,t){let i=this.cache,r=t.allocateTextureUnit();i[0]!==r&&(n.uniform1i(this.addr,r),i[0]=r),t.setTexture2DArray(e||jy,r)}function rA(n){switch(n){case 5126:return kT;case 35664:return zT;case 35665:return VT;case 35666:return HT;case 35674:return GT;case 35675:return WT;case 35676:return XT;case 5124:case 35670:return YT;case 35667:case 35671:return qT;case 35668:case 35672:return $T;case 35669:case 35673:return ZT;case 5125:return JT;case 36294:return KT;case 36295:return QT;case 36296:return jT;case 35678:case 36198:case 36298:case 36306:case 35682:return eA;case 35679:case 36299:case 36307:return tA;case 35680:case 36300:case 36308:case 36293:return nA;case 36289:case 36303:case 36311:case 36292:return iA}}function sA(n,e){n.uniform1fv(this.addr,e)}function oA(n,e){let t=xo(e,this.size,2);n.uniform2fv(this.addr,t)}function aA(n,e){let t=xo(e,this.size,3);n.uniform3fv(this.addr,t)}function lA(n,e){let t=xo(e,this.size,4);n.uniform4fv(this.addr,t)}function cA(n,e){let t=xo(e,this.size,4);n.uniformMatrix2fv(this.addr,!1,t)}function uA(n,e){let t=xo(e,this.size,9);n.uniformMatrix3fv(this.addr,!1,t)}function hA(n,e){let t=xo(e,this.size,16);n.uniformMatrix4fv(this.addr,!1,t)}function fA(n,e){n.uniform1iv(this.addr,e)}function dA(n,e){n.uniform2iv(this.addr,e)}function pA(n,e){n.uniform3iv(this.addr,e)}function mA(n,e){n.uniform4iv(this.addr,e)}function gA(n,e){n.uniform1uiv(this.addr,e)}function vA(n,e){n.uniform2uiv(this.addr,e)}function xA(n,e){n.uniform3uiv(this.addr,e)}function yA(n,e){n.uniform4uiv(this.addr,e)}function _A(n,e,t){let i=this.cache,r=e.length,s=_h(t,r);It(i,s)||(n.uniform1iv(this.addr,s),Lt(i,s));for(let o=0;o!==r;++o)t.setTexture2D(e[o]||Qy,s[o])}function SA(n,e,t){let i=this.cache,r=e.length,s=_h(t,r);It(i,s)||(n.uniform1iv(this.addr,s),Lt(i,s));for(let o=0;o!==r;++o)t.setTexture3D(e[o]||e_,s[o])}function MA(n,e,t){let i=this.cache,r=e.length,s=_h(t,r);It(i,s)||(n.uniform1iv(this.addr,s),Lt(i,s));for(let o=0;o!==r;++o)t.setTextureCube(e[o]||t_,s[o])}function wA(n,e,t){let i=this.cache,r=e.length,s=_h(t,r);It(i,s)||(n.uniform1iv(this.addr,s),Lt(i,s));for(let o=0;o!==r;++o)t.setTexture2DArray(e[o]||jy,s[o])}function EA(n){switch(n){case 5126:return sA;case 35664:return oA;case 35665:return aA;case 35666:return lA;case 35674:return cA;case 35675:return uA;case 35676:return hA;case 5124:case 35670:return fA;case 35667:case 35671:return dA;case 35668:case 35672:return pA;case 35669:case 35673:return mA;case 5125:return gA;case 36294:return vA;case 36295:return xA;case 36296:return yA;case 35678:case 36198:case 36298:case 36306:case 35682:return _A;case 35679:case 36299:case 36307:return SA;case 35680:case 36300:case 36308:case 36293:return MA;case 36289:case 36303:case 36311:case 36292:return wA}}var cm=class{constructor(e,t,i){this.id=e,this.addr=i,this.cache=[],this.type=t.type,this.setValue=rA(t.type)}},um=class{constructor(e,t,i){this.id=e,this.addr=i,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=EA(t.type)}},hm=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,i){let r=this.seq;for(let s=0,o=r.length;s!==o;++s){let a=r[s];a.setValue(e,t[a.id],i)}}},lm=/(\w+)(\])?(\[|\.)?/g;function zy(n,e){n.seq.push(e),n.map[e.id]=e}function TA(n,e,t){let i=n.name,r=i.length;for(lm.lastIndex=0;;){let s=lm.exec(i),o=lm.lastIndex,a=s[1],l=s[2]==="]",u=s[3];if(l&&(a=a|0),u===void 0||u==="["&&o+2===r){zy(t,u===void 0?new cm(a,n,e):new um(a,n,e));break}else{let c=t.map[a];c===void 0&&(c=new hm(a),zy(t,c)),t=c}}}var vo=class{constructor(e,t){this.seq=[],this.map={};let i=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let r=0;r<i;++r){let s=e.getActiveUniform(t,r),o=e.getUniformLocation(t,s.name);TA(s,o,this)}}setValue(e,t,i,r){let s=this.map[t];s!==void 0&&s.setValue(e,i,r)}setOptional(e,t,i){let r=t[i];r!==void 0&&this.setValue(e,i,r)}static upload(e,t,i,r){for(let s=0,o=t.length;s!==o;++s){let a=t[s],l=i[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,r)}}static seqWithValue(e,t){let i=[];for(let r=0,s=e.length;r!==s;++r){let o=e[r];o.id in t&&i.push(o)}return i}};function Vy(n,e,t){let i=n.createShader(e);return n.shaderSource(i,t),n.compileShader(i),i}var AA=37297,bA=0;function CA(n,e){let t=n.split(`
`),i=[],r=Math.max(e-6,0),s=Math.min(e+6,t.length);for(let o=r;o<s;o++){let a=o+1;i.push(`${a===e?">":" "} ${a}: ${t[o]}`)}return i.join(`
`)}var Hy=new $e;function RA(n){tt._getMatrix(Hy,tt.workingColorSpace,n);let e=`mat3( ${Hy.elements.map(t=>t.toFixed(4))} )`;switch(tt.getTransfer(n)){case Ma:return[e,"LinearTransferOETF"];case st:return[e,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",n),[e,"LinearTransferOETF"]}}function Gy(n,e,t){let i=n.getShaderParameter(e,n.COMPILE_STATUS),s=(n.getShaderInfoLog(e)||"").trim();if(i&&s==="")return"";let o=/ERROR: 0:(\d+)/.exec(s);if(o){let a=parseInt(o[1]);return t.toUpperCase()+`

`+s+`

`+CA(n.getShaderSource(e),a)}else return s}function PA(n,e){let t=RA(e);return[`vec4 ${n}( vec4 value ) {`,`	return ${t[1]}( vec4( value.rgb * ${t[0]}, value.a ) );`,"}"].join(`
`)}function IA(n,e){let t;switch(e){case ty:t="Linear";break;case ny:t="Reinhard";break;case iy:t="Cineon";break;case ry:t="ACESFilmic";break;case oy:t="AgX";break;case ay:t="Neutral";break;case sy:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+n+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}var vh=new V;function LA(){tt.getLuminanceCoefficients(vh);let n=vh.x.toFixed(4),e=vh.y.toFixed(4),t=vh.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${n}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function DA(n){return[n.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",n.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(nl).join(`
`)}function NA(n){let e=[];for(let t in n){let i=n[t];i!==!1&&e.push("#define "+t+" "+i)}return e.join(`
`)}function UA(n,e){let t={},i=n.getProgramParameter(e,n.ACTIVE_ATTRIBUTES);for(let r=0;r<i;r++){let s=n.getActiveAttrib(e,r),o=s.name,a=1;s.type===n.FLOAT_MAT2&&(a=2),s.type===n.FLOAT_MAT3&&(a=3),s.type===n.FLOAT_MAT4&&(a=4),t[o]={type:s.type,location:n.getAttribLocation(e,o),locationSize:a}}return t}function nl(n){return n!==""}function Wy(n,e){let t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return n.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function Xy(n,e){return n.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var FA=/^[ \t]*#include +<([\w\d./]+)>/gm;function fm(n){return n.replace(FA,BA)}var OA=new Map;function BA(n,e){let t=Ze[e];if(t===void 0){let i=OA.get(e);if(i!==void 0)t=Ze[i],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,i);else throw new Error("Can not resolve #include <"+e+">")}return fm(t)}var kA=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Yy(n){return n.replace(kA,zA)}function zA(n,e,t,i){let r="";for(let s=parseInt(e);s<parseInt(t);s++)r+=i.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return r}function qy(n){let e=`precision ${n.precision} float;
	precision ${n.precision} int;
	precision ${n.precision} sampler2D;
	precision ${n.precision} samplerCube;
	precision ${n.precision} sampler3D;
	precision ${n.precision} sampler2DArray;
	precision ${n.precision} sampler2DShadow;
	precision ${n.precision} samplerCubeShadow;
	precision ${n.precision} sampler2DArrayShadow;
	precision ${n.precision} isampler2D;
	precision ${n.precision} isampler3D;
	precision ${n.precision} isamplerCube;
	precision ${n.precision} isampler2DArray;
	precision ${n.precision} usampler2D;
	precision ${n.precision} usampler3D;
	precision ${n.precision} usamplerCube;
	precision ${n.precision} usampler2DArray;
	`;return n.precision==="highp"?e+=`
#define HIGH_PRECISION`:n.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:n.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function VA(n){let e="SHADOWMAP_TYPE_BASIC";return n.shadowMapType===Np?e="SHADOWMAP_TYPE_PCF":n.shadowMapType===Eu?e="SHADOWMAP_TYPE_PCF_SOFT":n.shadowMapType===fi&&(e="SHADOWMAP_TYPE_VSM"),e}function HA(n){let e="ENVMAP_TYPE_CUBE";if(n.envMap)switch(n.envMapMode){case es:case ts:e="ENVMAP_TYPE_CUBE";break;case Ja:e="ENVMAP_TYPE_CUBE_UV";break}return e}function GA(n){let e="ENVMAP_MODE_REFLECTION";if(n.envMap)switch(n.envMapMode){case ts:e="ENVMAP_MODE_REFRACTION";break}return e}function WA(n){let e="ENVMAP_BLENDING_NONE";if(n.envMap)switch(n.combine){case Bp:e="ENVMAP_BLENDING_MULTIPLY";break;case jx:e="ENVMAP_BLENDING_MIX";break;case ey:e="ENVMAP_BLENDING_ADD";break}return e}function XA(n){let e=n.envMapCubeUVHeight;if(e===null)return null;let t=Math.log2(e)-2,i=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),112)),texelHeight:i,maxMip:t}}function YA(n,e,t,i){let r=n.getContext(),s=t.defines,o=t.vertexShader,a=t.fragmentShader,l=VA(t),u=HA(t),h=GA(t),c=WA(t),f=XA(t),d=DA(t),m=NA(s),x=r.createProgram(),y,p,_=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(y=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m].filter(nl).join(`
`),y.length>0&&(y+=`
`),p=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m].filter(nl).join(`
`),p.length>0&&(p+=`
`)):(y=[qy(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+h:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(nl).join(`
`),p=[qy(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+u:"",t.envMap?"#define "+h:"",t.envMap?"#define "+c:"",f?"#define CUBEUV_TEXEL_WIDTH "+f.texelWidth:"",f?"#define CUBEUV_TEXEL_HEIGHT "+f.texelHeight:"",f?"#define CUBEUV_MAX_MIP "+f.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor||t.batchingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==ki?"#define TONE_MAPPING":"",t.toneMapping!==ki?Ze.tonemapping_pars_fragment:"",t.toneMapping!==ki?IA("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",Ze.colorspace_pars_fragment,PA("linearToOutputTexel",t.outputColorSpace),LA(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(nl).join(`
`)),o=fm(o),o=Wy(o,t),o=Xy(o,t),a=fm(a),a=Wy(a,t),a=Xy(a,t),o=Yy(o),a=Yy(a),t.isRawShaderMaterial!==!0&&(_=`#version 300 es
`,y=[d,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+y,p=["#define varying in",t.glslVersion===Jp?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===Jp?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+p);let g=_+y+o,v=_+p+a,M=Vy(r,r.VERTEX_SHADER,g),S=Vy(r,r.FRAGMENT_SHADER,v);r.attachShader(x,M),r.attachShader(x,S),t.index0AttributeName!==void 0?r.bindAttribLocation(x,0,t.index0AttributeName):t.morphTargets===!0&&r.bindAttribLocation(x,0,"position"),r.linkProgram(x);function E(b){if(n.debug.checkShaderErrors){let L=r.getProgramInfoLog(x)||"",D=r.getShaderInfoLog(M)||"",F=r.getShaderInfoLog(S)||"",U=L.trim(),O=D.trim(),Z=F.trim(),W=!0,ne=!0;if(r.getProgramParameter(x,r.LINK_STATUS)===!1)if(W=!1,typeof n.debug.onShaderError=="function")n.debug.onShaderError(r,x,M,S);else{let re=Gy(r,M,"vertex"),de=Gy(r,S,"fragment");console.error("THREE.WebGLProgram: Shader Error "+r.getError()+" - VALIDATE_STATUS "+r.getProgramParameter(x,r.VALIDATE_STATUS)+`

Material Name: `+b.name+`
Material Type: `+b.type+`

Program Info Log: `+U+`
`+re+`
`+de)}else U!==""?console.warn("THREE.WebGLProgram: Program Info Log:",U):(O===""||Z==="")&&(ne=!1);ne&&(b.diagnostics={runnable:W,programLog:U,vertexShader:{log:O,prefix:y},fragmentShader:{log:Z,prefix:p}})}r.deleteShader(M),r.deleteShader(S),A=new vo(r,x),w=UA(r,x)}let A;this.getUniforms=function(){return A===void 0&&E(this),A};let w;this.getAttributes=function(){return w===void 0&&E(this),w};let T=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return T===!1&&(T=r.getProgramParameter(x,AA)),T},this.destroy=function(){i.releaseStatesOfProgram(this),r.deleteProgram(x),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=bA++,this.cacheKey=e,this.usedTimes=1,this.program=x,this.vertexShader=M,this.fragmentShader=S,this}var qA=0,dm=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let t=e.vertexShader,i=e.fragmentShader,r=this._getShaderStage(t),s=this._getShaderStage(i),o=this._getShaderCacheForMaterial(e);return o.has(r)===!1&&(o.add(r),r.usedTimes++),o.has(s)===!1&&(o.add(s),s.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let i of t)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,i=t.get(e);return i===void 0&&(i=new Set,t.set(e,i)),i}_getShaderStage(e){let t=this.shaderCache,i=t.get(e);return i===void 0&&(i=new pm(e),t.set(e,i)),i}},pm=class{constructor(e){this.id=qA++,this.code=e,this.usedTimes=0}};function $A(n,e,t,i,r,s,o){let a=new no,l=new dm,u=new Set,h=[],c=r.logarithmicDepthBuffer,f=r.vertexTextures,d=r.precision,m={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function x(w){return u.add(w),w===0?"uv":`uv${w}`}function y(w,T,b,L,D){let F=L.fog,U=D.geometry,O=w.isMeshStandardMaterial?L.environment:null,Z=(w.isMeshStandardMaterial?t:e).get(w.envMap||O),W=Z&&Z.mapping===Ja?Z.image.height:null,ne=m[w.type];w.precision!==null&&(d=r.getMaxPrecision(w.precision),d!==w.precision&&console.warn("THREE.WebGLProgram.getParameters:",w.precision,"not supported, using",d,"instead."));let re=U.morphAttributes.position||U.morphAttributes.normal||U.morphAttributes.color,de=re!==void 0?re.length:0,Ue=0;U.morphAttributes.position!==void 0&&(Ue=1),U.morphAttributes.normal!==void 0&&(Ue=2),U.morphAttributes.color!==void 0&&(Ue=3);let He,Ee,Ve,q;if(ne){let it=mi[ne];He=it.vertexShader,Ee=it.fragmentShader}else He=w.vertexShader,Ee=w.fragmentShader,l.update(w),Ve=l.getVertexShaderID(w),q=l.getFragmentShaderID(w);let ee=n.getRenderTarget(),pe=n.state.buffers.depth.getReversed(),Te=D.isInstancedMesh===!0,ve=D.isBatchedMesh===!0,Xe=!!w.map,Fe=!!w.matcap,I=!!Z,qe=!!w.aoMap,De=!!w.lightMap,H=!!w.bumpMap,G=!!w.normalMap,te=!!w.displacementMap,J=!!w.emissiveMap,fe=!!w.metalnessMap,Ie=!!w.roughnessMap,_e=w.anisotropy>0,P=w.clearcoat>0,C=w.dispersion>0,B=w.iridescence>0,K=w.sheen>0,Q=w.transmission>0,$=_e&&!!w.anisotropyMap,Ae=P&&!!w.clearcoatMap,ue=P&&!!w.clearcoatNormalMap,be=P&&!!w.clearcoatRoughnessMap,Le=B&&!!w.iridescenceMap,se=B&&!!w.iridescenceThicknessMap,ae=K&&!!w.sheenColorMap,Be=K&&!!w.sheenRoughnessMap,Pe=!!w.specularMap,me=!!w.specularColorMap,Ye=!!w.specularIntensityMap,N=Q&&!!w.transmissionMap,ie=Q&&!!w.thicknessMap,oe=!!w.gradientMap,ge=!!w.alphaMap,le=w.alphaTest>0,j=!!w.alphaHash,Ce=!!w.extensions,We=ki;w.toneMapped&&(ee===null||ee.isXRRenderTarget===!0)&&(We=n.toneMapping);let lt={shaderID:ne,shaderType:w.type,shaderName:w.name,vertexShader:He,fragmentShader:Ee,defines:w.defines,customVertexShaderID:Ve,customFragmentShaderID:q,isRawShaderMaterial:w.isRawShaderMaterial===!0,glslVersion:w.glslVersion,precision:d,batching:ve,batchingColor:ve&&D._colorsTexture!==null,instancing:Te,instancingColor:Te&&D.instanceColor!==null,instancingMorph:Te&&D.morphTexture!==null,supportsVertexTextures:f,outputColorSpace:ee===null?n.outputColorSpace:ee.isXRRenderTarget===!0?ee.texture.colorSpace:qr,alphaToCoverage:!!w.alphaToCoverage,map:Xe,matcap:Fe,envMap:I,envMapMode:I&&Z.mapping,envMapCubeUVHeight:W,aoMap:qe,lightMap:De,bumpMap:H,normalMap:G,displacementMap:f&&te,emissiveMap:J,normalMapObjectSpace:G&&w.normalMapType===hy,normalMapTangentSpace:G&&w.normalMapType===$p,metalnessMap:fe,roughnessMap:Ie,anisotropy:_e,anisotropyMap:$,clearcoat:P,clearcoatMap:Ae,clearcoatNormalMap:ue,clearcoatRoughnessMap:be,dispersion:C,iridescence:B,iridescenceMap:Le,iridescenceThicknessMap:se,sheen:K,sheenColorMap:ae,sheenRoughnessMap:Be,specularMap:Pe,specularColorMap:me,specularIntensityMap:Ye,transmission:Q,transmissionMap:N,thicknessMap:ie,gradientMap:oe,opaque:w.transparent===!1&&w.blending===Xr&&w.alphaToCoverage===!1,alphaMap:ge,alphaTest:le,alphaHash:j,combine:w.combine,mapUv:Xe&&x(w.map.channel),aoMapUv:qe&&x(w.aoMap.channel),lightMapUv:De&&x(w.lightMap.channel),bumpMapUv:H&&x(w.bumpMap.channel),normalMapUv:G&&x(w.normalMap.channel),displacementMapUv:te&&x(w.displacementMap.channel),emissiveMapUv:J&&x(w.emissiveMap.channel),metalnessMapUv:fe&&x(w.metalnessMap.channel),roughnessMapUv:Ie&&x(w.roughnessMap.channel),anisotropyMapUv:$&&x(w.anisotropyMap.channel),clearcoatMapUv:Ae&&x(w.clearcoatMap.channel),clearcoatNormalMapUv:ue&&x(w.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:be&&x(w.clearcoatRoughnessMap.channel),iridescenceMapUv:Le&&x(w.iridescenceMap.channel),iridescenceThicknessMapUv:se&&x(w.iridescenceThicknessMap.channel),sheenColorMapUv:ae&&x(w.sheenColorMap.channel),sheenRoughnessMapUv:Be&&x(w.sheenRoughnessMap.channel),specularMapUv:Pe&&x(w.specularMap.channel),specularColorMapUv:me&&x(w.specularColorMap.channel),specularIntensityMapUv:Ye&&x(w.specularIntensityMap.channel),transmissionMapUv:N&&x(w.transmissionMap.channel),thicknessMapUv:ie&&x(w.thicknessMap.channel),alphaMapUv:ge&&x(w.alphaMap.channel),vertexTangents:!!U.attributes.tangent&&(G||_e),vertexColors:w.vertexColors,vertexAlphas:w.vertexColors===!0&&!!U.attributes.color&&U.attributes.color.itemSize===4,pointsUvs:D.isPoints===!0&&!!U.attributes.uv&&(Xe||ge),fog:!!F,useFog:w.fog===!0,fogExp2:!!F&&F.isFogExp2,flatShading:w.flatShading===!0&&w.wireframe===!1,sizeAttenuation:w.sizeAttenuation===!0,logarithmicDepthBuffer:c,reversedDepthBuffer:pe,skinning:D.isSkinnedMesh===!0,morphTargets:U.morphAttributes.position!==void 0,morphNormals:U.morphAttributes.normal!==void 0,morphColors:U.morphAttributes.color!==void 0,morphTargetsCount:de,morphTextureStride:Ue,numDirLights:T.directional.length,numPointLights:T.point.length,numSpotLights:T.spot.length,numSpotLightMaps:T.spotLightMap.length,numRectAreaLights:T.rectArea.length,numHemiLights:T.hemi.length,numDirLightShadows:T.directionalShadowMap.length,numPointLightShadows:T.pointShadowMap.length,numSpotLightShadows:T.spotShadowMap.length,numSpotLightShadowsWithMaps:T.numSpotLightShadowsWithMaps,numLightProbes:T.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:w.dithering,shadowMapEnabled:n.shadowMap.enabled&&b.length>0,shadowMapType:n.shadowMap.type,toneMapping:We,decodeVideoTexture:Xe&&w.map.isVideoTexture===!0&&tt.getTransfer(w.map.colorSpace)===st,decodeVideoTextureEmissive:J&&w.emissiveMap.isVideoTexture===!0&&tt.getTransfer(w.emissiveMap.colorSpace)===st,premultipliedAlpha:w.premultipliedAlpha,doubleSided:w.side===di,flipSided:w.side===sn,useDepthPacking:w.depthPacking>=0,depthPacking:w.depthPacking||0,index0AttributeName:w.index0AttributeName,extensionClipCullDistance:Ce&&w.extensions.clipCullDistance===!0&&i.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(Ce&&w.extensions.multiDraw===!0||ve)&&i.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:i.has("KHR_parallel_shader_compile"),customProgramCacheKey:w.customProgramCacheKey()};return lt.vertexUv1s=u.has(1),lt.vertexUv2s=u.has(2),lt.vertexUv3s=u.has(3),u.clear(),lt}function p(w){let T=[];if(w.shaderID?T.push(w.shaderID):(T.push(w.customVertexShaderID),T.push(w.customFragmentShaderID)),w.defines!==void 0)for(let b in w.defines)T.push(b),T.push(w.defines[b]);return w.isRawShaderMaterial===!1&&(_(T,w),g(T,w),T.push(n.outputColorSpace)),T.push(w.customProgramCacheKey),T.join()}function _(w,T){w.push(T.precision),w.push(T.outputColorSpace),w.push(T.envMapMode),w.push(T.envMapCubeUVHeight),w.push(T.mapUv),w.push(T.alphaMapUv),w.push(T.lightMapUv),w.push(T.aoMapUv),w.push(T.bumpMapUv),w.push(T.normalMapUv),w.push(T.displacementMapUv),w.push(T.emissiveMapUv),w.push(T.metalnessMapUv),w.push(T.roughnessMapUv),w.push(T.anisotropyMapUv),w.push(T.clearcoatMapUv),w.push(T.clearcoatNormalMapUv),w.push(T.clearcoatRoughnessMapUv),w.push(T.iridescenceMapUv),w.push(T.iridescenceThicknessMapUv),w.push(T.sheenColorMapUv),w.push(T.sheenRoughnessMapUv),w.push(T.specularMapUv),w.push(T.specularColorMapUv),w.push(T.specularIntensityMapUv),w.push(T.transmissionMapUv),w.push(T.thicknessMapUv),w.push(T.combine),w.push(T.fogExp2),w.push(T.sizeAttenuation),w.push(T.morphTargetsCount),w.push(T.morphAttributeCount),w.push(T.numDirLights),w.push(T.numPointLights),w.push(T.numSpotLights),w.push(T.numSpotLightMaps),w.push(T.numHemiLights),w.push(T.numRectAreaLights),w.push(T.numDirLightShadows),w.push(T.numPointLightShadows),w.push(T.numSpotLightShadows),w.push(T.numSpotLightShadowsWithMaps),w.push(T.numLightProbes),w.push(T.shadowMapType),w.push(T.toneMapping),w.push(T.numClippingPlanes),w.push(T.numClipIntersection),w.push(T.depthPacking)}function g(w,T){a.disableAll(),T.supportsVertexTextures&&a.enable(0),T.instancing&&a.enable(1),T.instancingColor&&a.enable(2),T.instancingMorph&&a.enable(3),T.matcap&&a.enable(4),T.envMap&&a.enable(5),T.normalMapObjectSpace&&a.enable(6),T.normalMapTangentSpace&&a.enable(7),T.clearcoat&&a.enable(8),T.iridescence&&a.enable(9),T.alphaTest&&a.enable(10),T.vertexColors&&a.enable(11),T.vertexAlphas&&a.enable(12),T.vertexUv1s&&a.enable(13),T.vertexUv2s&&a.enable(14),T.vertexUv3s&&a.enable(15),T.vertexTangents&&a.enable(16),T.anisotropy&&a.enable(17),T.alphaHash&&a.enable(18),T.batching&&a.enable(19),T.dispersion&&a.enable(20),T.batchingColor&&a.enable(21),T.gradientMap&&a.enable(22),w.push(a.mask),a.disableAll(),T.fog&&a.enable(0),T.useFog&&a.enable(1),T.flatShading&&a.enable(2),T.logarithmicDepthBuffer&&a.enable(3),T.reversedDepthBuffer&&a.enable(4),T.skinning&&a.enable(5),T.morphTargets&&a.enable(6),T.morphNormals&&a.enable(7),T.morphColors&&a.enable(8),T.premultipliedAlpha&&a.enable(9),T.shadowMapEnabled&&a.enable(10),T.doubleSided&&a.enable(11),T.flipSided&&a.enable(12),T.useDepthPacking&&a.enable(13),T.dithering&&a.enable(14),T.transmission&&a.enable(15),T.sheen&&a.enable(16),T.opaque&&a.enable(17),T.pointsUvs&&a.enable(18),T.decodeVideoTexture&&a.enable(19),T.decodeVideoTextureEmissive&&a.enable(20),T.alphaToCoverage&&a.enable(21),w.push(a.mask)}function v(w){let T=m[w.type],b;if(T){let L=mi[T];b=My.clone(L.uniforms)}else b=w.uniforms;return b}function M(w,T){let b;for(let L=0,D=h.length;L<D;L++){let F=h[L];if(F.cacheKey===T){b=F,++b.usedTimes;break}}return b===void 0&&(b=new YA(n,T,w,s),h.push(b)),b}function S(w){if(--w.usedTimes===0){let T=h.indexOf(w);h[T]=h[h.length-1],h.pop(),w.destroy()}}function E(w){l.remove(w)}function A(){l.dispose()}return{getParameters:y,getProgramCacheKey:p,getUniforms:v,acquireProgram:M,releaseProgram:S,releaseShaderCache:E,programs:h,dispose:A}}function ZA(){let n=new WeakMap;function e(o){return n.has(o)}function t(o){let a=n.get(o);return a===void 0&&(a={},n.set(o,a)),a}function i(o){n.delete(o)}function r(o,a,l){n.get(o)[a]=l}function s(){n=new WeakMap}return{has:e,get:t,remove:i,update:r,dispose:s}}function JA(n,e){return n.groupOrder!==e.groupOrder?n.groupOrder-e.groupOrder:n.renderOrder!==e.renderOrder?n.renderOrder-e.renderOrder:n.material.id!==e.material.id?n.material.id-e.material.id:n.z!==e.z?n.z-e.z:n.id-e.id}function $y(n,e){return n.groupOrder!==e.groupOrder?n.groupOrder-e.groupOrder:n.renderOrder!==e.renderOrder?n.renderOrder-e.renderOrder:n.z!==e.z?e.z-n.z:n.id-e.id}function Zy(){let n=[],e=0,t=[],i=[],r=[];function s(){e=0,t.length=0,i.length=0,r.length=0}function o(c,f,d,m,x,y){let p=n[e];return p===void 0?(p={id:c.id,object:c,geometry:f,material:d,groupOrder:m,renderOrder:c.renderOrder,z:x,group:y},n[e]=p):(p.id=c.id,p.object=c,p.geometry=f,p.material=d,p.groupOrder=m,p.renderOrder=c.renderOrder,p.z=x,p.group=y),e++,p}function a(c,f,d,m,x,y){let p=o(c,f,d,m,x,y);d.transmission>0?i.push(p):d.transparent===!0?r.push(p):t.push(p)}function l(c,f,d,m,x,y){let p=o(c,f,d,m,x,y);d.transmission>0?i.unshift(p):d.transparent===!0?r.unshift(p):t.unshift(p)}function u(c,f){t.length>1&&t.sort(c||JA),i.length>1&&i.sort(f||$y),r.length>1&&r.sort(f||$y)}function h(){for(let c=e,f=n.length;c<f;c++){let d=n[c];if(d.id===null)break;d.id=null,d.object=null,d.geometry=null,d.material=null,d.group=null}}return{opaque:t,transmissive:i,transparent:r,init:s,push:a,unshift:l,finish:h,sort:u}}function KA(){let n=new WeakMap;function e(i,r){let s=n.get(i),o;return s===void 0?(o=new Zy,n.set(i,[o])):r>=s.length?(o=new Zy,s.push(o)):o=s[r],o}function t(){n=new WeakMap}return{get:e,dispose:t}}function QA(){let n={};return{get:function(e){if(n[e.id]!==void 0)return n[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new V,color:new je};break;case"SpotLight":t={position:new V,direction:new V,color:new je,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new V,color:new je,distance:0,decay:0};break;case"HemisphereLight":t={direction:new V,skyColor:new je,groundColor:new je};break;case"RectAreaLight":t={color:new je,position:new V,halfWidth:new V,halfHeight:new V};break}return n[e.id]=t,t}}}function jA(){let n={};return{get:function(e){if(n[e.id]!==void 0)return n[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Se};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Se};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Se,shadowCameraNear:1,shadowCameraFar:1e3};break}return n[e.id]=t,t}}}var eb=0;function tb(n,e){return(e.castShadow?2:0)-(n.castShadow?2:0)+(e.map?1:0)-(n.map?1:0)}function nb(n){let e=new QA,t=jA(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let u=0;u<9;u++)i.probe.push(new V);let r=new V,s=new Mt,o=new Mt;function a(u){let h=0,c=0,f=0;for(let w=0;w<9;w++)i.probe[w].set(0,0,0);let d=0,m=0,x=0,y=0,p=0,_=0,g=0,v=0,M=0,S=0,E=0;u.sort(tb);for(let w=0,T=u.length;w<T;w++){let b=u[w],L=b.color,D=b.intensity,F=b.distance,U=b.shadow&&b.shadow.map?b.shadow.map.texture:null;if(b.isAmbientLight)h+=L.r*D,c+=L.g*D,f+=L.b*D;else if(b.isLightProbe){for(let O=0;O<9;O++)i.probe[O].addScaledVector(b.sh.coefficients[O],D);E++}else if(b.isDirectionalLight){let O=e.get(b);if(O.color.copy(b.color).multiplyScalar(b.intensity),b.castShadow){let Z=b.shadow,W=t.get(b);W.shadowIntensity=Z.intensity,W.shadowBias=Z.bias,W.shadowNormalBias=Z.normalBias,W.shadowRadius=Z.radius,W.shadowMapSize=Z.mapSize,i.directionalShadow[d]=W,i.directionalShadowMap[d]=U,i.directionalShadowMatrix[d]=b.shadow.matrix,_++}i.directional[d]=O,d++}else if(b.isSpotLight){let O=e.get(b);O.position.setFromMatrixPosition(b.matrixWorld),O.color.copy(L).multiplyScalar(D),O.distance=F,O.coneCos=Math.cos(b.angle),O.penumbraCos=Math.cos(b.angle*(1-b.penumbra)),O.decay=b.decay,i.spot[x]=O;let Z=b.shadow;if(b.map&&(i.spotLightMap[M]=b.map,M++,Z.updateMatrices(b),b.castShadow&&S++),i.spotLightMatrix[x]=Z.matrix,b.castShadow){let W=t.get(b);W.shadowIntensity=Z.intensity,W.shadowBias=Z.bias,W.shadowNormalBias=Z.normalBias,W.shadowRadius=Z.radius,W.shadowMapSize=Z.mapSize,i.spotShadow[x]=W,i.spotShadowMap[x]=U,v++}x++}else if(b.isRectAreaLight){let O=e.get(b);O.color.copy(L).multiplyScalar(D),O.halfWidth.set(b.width*.5,0,0),O.halfHeight.set(0,b.height*.5,0),i.rectArea[y]=O,y++}else if(b.isPointLight){let O=e.get(b);if(O.color.copy(b.color).multiplyScalar(b.intensity),O.distance=b.distance,O.decay=b.decay,b.castShadow){let Z=b.shadow,W=t.get(b);W.shadowIntensity=Z.intensity,W.shadowBias=Z.bias,W.shadowNormalBias=Z.normalBias,W.shadowRadius=Z.radius,W.shadowMapSize=Z.mapSize,W.shadowCameraNear=Z.camera.near,W.shadowCameraFar=Z.camera.far,i.pointShadow[m]=W,i.pointShadowMap[m]=U,i.pointShadowMatrix[m]=b.shadow.matrix,g++}i.point[m]=O,m++}else if(b.isHemisphereLight){let O=e.get(b);O.skyColor.copy(b.color).multiplyScalar(D),O.groundColor.copy(b.groundColor).multiplyScalar(D),i.hemi[p]=O,p++}}y>0&&(n.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=xe.LTC_FLOAT_1,i.rectAreaLTC2=xe.LTC_FLOAT_2):(i.rectAreaLTC1=xe.LTC_HALF_1,i.rectAreaLTC2=xe.LTC_HALF_2)),i.ambient[0]=h,i.ambient[1]=c,i.ambient[2]=f;let A=i.hash;(A.directionalLength!==d||A.pointLength!==m||A.spotLength!==x||A.rectAreaLength!==y||A.hemiLength!==p||A.numDirectionalShadows!==_||A.numPointShadows!==g||A.numSpotShadows!==v||A.numSpotMaps!==M||A.numLightProbes!==E)&&(i.directional.length=d,i.spot.length=x,i.rectArea.length=y,i.point.length=m,i.hemi.length=p,i.directionalShadow.length=_,i.directionalShadowMap.length=_,i.pointShadow.length=g,i.pointShadowMap.length=g,i.spotShadow.length=v,i.spotShadowMap.length=v,i.directionalShadowMatrix.length=_,i.pointShadowMatrix.length=g,i.spotLightMatrix.length=v+M-S,i.spotLightMap.length=M,i.numSpotLightShadowsWithMaps=S,i.numLightProbes=E,A.directionalLength=d,A.pointLength=m,A.spotLength=x,A.rectAreaLength=y,A.hemiLength=p,A.numDirectionalShadows=_,A.numPointShadows=g,A.numSpotShadows=v,A.numSpotMaps=M,A.numLightProbes=E,i.version=eb++)}function l(u,h){let c=0,f=0,d=0,m=0,x=0,y=h.matrixWorldInverse;for(let p=0,_=u.length;p<_;p++){let g=u[p];if(g.isDirectionalLight){let v=i.directional[c];v.direction.setFromMatrixPosition(g.matrixWorld),r.setFromMatrixPosition(g.target.matrixWorld),v.direction.sub(r),v.direction.transformDirection(y),c++}else if(g.isSpotLight){let v=i.spot[d];v.position.setFromMatrixPosition(g.matrixWorld),v.position.applyMatrix4(y),v.direction.setFromMatrixPosition(g.matrixWorld),r.setFromMatrixPosition(g.target.matrixWorld),v.direction.sub(r),v.direction.transformDirection(y),d++}else if(g.isRectAreaLight){let v=i.rectArea[m];v.position.setFromMatrixPosition(g.matrixWorld),v.position.applyMatrix4(y),o.identity(),s.copy(g.matrixWorld),s.premultiply(y),o.extractRotation(s),v.halfWidth.set(g.width*.5,0,0),v.halfHeight.set(0,g.height*.5,0),v.halfWidth.applyMatrix4(o),v.halfHeight.applyMatrix4(o),m++}else if(g.isPointLight){let v=i.point[f];v.position.setFromMatrixPosition(g.matrixWorld),v.position.applyMatrix4(y),f++}else if(g.isHemisphereLight){let v=i.hemi[x];v.direction.setFromMatrixPosition(g.matrixWorld),v.direction.transformDirection(y),x++}}}return{setup:a,setupView:l,state:i}}function Jy(n){let e=new nb(n),t=[],i=[];function r(h){u.camera=h,t.length=0,i.length=0}function s(h){t.push(h)}function o(h){i.push(h)}function a(){e.setup(t)}function l(h){e.setupView(t,h)}let u={lightsArray:t,shadowsArray:i,camera:null,lights:e,transmissionRenderTarget:{}};return{init:r,state:u,setupLights:a,setupLightsView:l,pushLight:s,pushShadow:o}}function ib(n){let e=new WeakMap;function t(r,s=0){let o=e.get(r),a;return o===void 0?(a=new Jy(n),e.set(r,[a])):s>=o.length?(a=new Jy(n),o.push(a)):a=o[s],a}function i(){e=new WeakMap}return{get:t,dispose:i}}var rb=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,sb=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function ob(n,e,t){let i=new so,r=new Se,s=new Se,o=new wt,a=new fu({depthPacking:uy}),l=new du,u={},h=t.maxTextureSize,c={[Ni]:sn,[sn]:Ni,[di]:di},f=new ni({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Se},radius:{value:4}},vertexShader:rb,fragmentShader:sb}),d=f.clone();d.defines.HORIZONTAL_PASS=1;let m=new ti;m.setAttribute("position",new Tn(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let x=new rn(m,f),y=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Np;let p=this.type;this.render=function(S,E,A){if(y.enabled===!1||y.autoUpdate===!1&&y.needsUpdate===!1||S.length===0)return;let w=n.getRenderTarget(),T=n.getActiveCubeFace(),b=n.getActiveMipmapLevel(),L=n.state;L.setBlending(Bi),L.buffers.depth.getReversed()===!0?L.buffers.color.setClear(0,0,0,0):L.buffers.color.setClear(1,1,1,1),L.buffers.depth.setTest(!0),L.setScissorTest(!1);let D=p!==fi&&this.type===fi,F=p===fi&&this.type!==fi;for(let U=0,O=S.length;U<O;U++){let Z=S[U],W=Z.shadow;if(W===void 0){console.warn("THREE.WebGLShadowMap:",Z,"has no shadow.");continue}if(W.autoUpdate===!1&&W.needsUpdate===!1)continue;r.copy(W.mapSize);let ne=W.getFrameExtents();if(r.multiply(ne),s.copy(W.mapSize),(r.x>h||r.y>h)&&(r.x>h&&(s.x=Math.floor(h/ne.x),r.x=s.x*ne.x,W.mapSize.x=s.x),r.y>h&&(s.y=Math.floor(h/ne.y),r.y=s.y*ne.y,W.mapSize.y=s.y)),W.map===null||D===!0||F===!0){let de=this.type!==fi?{minFilter:kn,magFilter:kn}:{};W.map!==null&&W.map.dispose(),W.map=new hi(r.x,r.y,de),W.map.texture.name=Z.name+".shadowMap",W.camera.updateProjectionMatrix()}n.setRenderTarget(W.map),n.clear();let re=W.getViewportCount();for(let de=0;de<re;de++){let Ue=W.getViewport(de);o.set(s.x*Ue.x,s.y*Ue.y,s.x*Ue.z,s.y*Ue.w),L.viewport(o),W.updateMatrices(Z,de),i=W.getFrustum(),v(E,A,W.camera,Z,this.type)}W.isPointLightShadow!==!0&&this.type===fi&&_(W,A),W.needsUpdate=!1}p=this.type,y.needsUpdate=!1,n.setRenderTarget(w,T,b)};function _(S,E){let A=e.update(x);f.defines.VSM_SAMPLES!==S.blurSamples&&(f.defines.VSM_SAMPLES=S.blurSamples,d.defines.VSM_SAMPLES=S.blurSamples,f.needsUpdate=!0,d.needsUpdate=!0),S.mapPass===null&&(S.mapPass=new hi(r.x,r.y)),f.uniforms.shadow_pass.value=S.map.texture,f.uniforms.resolution.value=S.mapSize,f.uniforms.radius.value=S.radius,n.setRenderTarget(S.mapPass),n.clear(),n.renderBufferDirect(E,null,A,f,x,null),d.uniforms.shadow_pass.value=S.mapPass.texture,d.uniforms.resolution.value=S.mapSize,d.uniforms.radius.value=S.radius,n.setRenderTarget(S.map),n.clear(),n.renderBufferDirect(E,null,A,d,x,null)}function g(S,E,A,w){let T=null,b=A.isPointLight===!0?S.customDistanceMaterial:S.customDepthMaterial;if(b!==void 0)T=b;else if(T=A.isPointLight===!0?l:a,n.localClippingEnabled&&E.clipShadows===!0&&Array.isArray(E.clippingPlanes)&&E.clippingPlanes.length!==0||E.displacementMap&&E.displacementScale!==0||E.alphaMap&&E.alphaTest>0||E.map&&E.alphaTest>0||E.alphaToCoverage===!0){let L=T.uuid,D=E.uuid,F=u[L];F===void 0&&(F={},u[L]=F);let U=F[D];U===void 0&&(U=T.clone(),F[D]=U,E.addEventListener("dispose",M)),T=U}if(T.visible=E.visible,T.wireframe=E.wireframe,w===fi?T.side=E.shadowSide!==null?E.shadowSide:E.side:T.side=E.shadowSide!==null?E.shadowSide:c[E.side],T.alphaMap=E.alphaMap,T.alphaTest=E.alphaToCoverage===!0?.5:E.alphaTest,T.map=E.map,T.clipShadows=E.clipShadows,T.clippingPlanes=E.clippingPlanes,T.clipIntersection=E.clipIntersection,T.displacementMap=E.displacementMap,T.displacementScale=E.displacementScale,T.displacementBias=E.displacementBias,T.wireframeLinewidth=E.wireframeLinewidth,T.linewidth=E.linewidth,A.isPointLight===!0&&T.isMeshDistanceMaterial===!0){let L=n.properties.get(T);L.light=A}return T}function v(S,E,A,w,T){if(S.visible===!1)return;if(S.layers.test(E.layers)&&(S.isMesh||S.isLine||S.isPoints)&&(S.castShadow||S.receiveShadow&&T===fi)&&(!S.frustumCulled||i.intersectsObject(S))){S.modelViewMatrix.multiplyMatrices(A.matrixWorldInverse,S.matrixWorld);let D=e.update(S),F=S.material;if(Array.isArray(F)){let U=D.groups;for(let O=0,Z=U.length;O<Z;O++){let W=U[O],ne=F[W.materialIndex];if(ne&&ne.visible){let re=g(S,ne,w,T);S.onBeforeShadow(n,S,E,A,D,re,W),n.renderBufferDirect(A,null,D,re,S,W),S.onAfterShadow(n,S,E,A,D,re,W)}}}else if(F.visible){let U=g(S,F,w,T);S.onBeforeShadow(n,S,E,A,D,U,null),n.renderBufferDirect(A,null,D,U,S,null),S.onAfterShadow(n,S,E,A,D,U,null)}}let L=S.children;for(let D=0,F=L.length;D<F;D++)v(L[D],E,A,w,T)}function M(S){S.target.removeEventListener("dispose",M);for(let A in u){let w=u[A],T=S.target.uuid;T in w&&(w[T].dispose(),delete w[T])}}}var ab={[Tu]:Au,[bu]:Pu,[Cu]:Iu,[Yr]:Ru,[Au]:Tu,[Pu]:bu,[Iu]:Cu,[Ru]:Yr};function lb(n,e){function t(){let N=!1,ie=new wt,oe=null,ge=new wt(0,0,0,0);return{setMask:function(le){oe!==le&&!N&&(n.colorMask(le,le,le,le),oe=le)},setLocked:function(le){N=le},setClear:function(le,j,Ce,We,lt){lt===!0&&(le*=We,j*=We,Ce*=We),ie.set(le,j,Ce,We),ge.equals(ie)===!1&&(n.clearColor(le,j,Ce,We),ge.copy(ie))},reset:function(){N=!1,oe=null,ge.set(-1,0,0,0)}}}function i(){let N=!1,ie=!1,oe=null,ge=null,le=null;return{setReversed:function(j){if(ie!==j){let Ce=e.get("EXT_clip_control");j?Ce.clipControlEXT(Ce.LOWER_LEFT_EXT,Ce.ZERO_TO_ONE_EXT):Ce.clipControlEXT(Ce.LOWER_LEFT_EXT,Ce.NEGATIVE_ONE_TO_ONE_EXT),ie=j;let We=le;le=null,this.setClear(We)}},getReversed:function(){return ie},setTest:function(j){j?ee(n.DEPTH_TEST):pe(n.DEPTH_TEST)},setMask:function(j){oe!==j&&!N&&(n.depthMask(j),oe=j)},setFunc:function(j){if(ie&&(j=ab[j]),ge!==j){switch(j){case Tu:n.depthFunc(n.NEVER);break;case Au:n.depthFunc(n.ALWAYS);break;case bu:n.depthFunc(n.LESS);break;case Yr:n.depthFunc(n.LEQUAL);break;case Cu:n.depthFunc(n.EQUAL);break;case Ru:n.depthFunc(n.GEQUAL);break;case Pu:n.depthFunc(n.GREATER);break;case Iu:n.depthFunc(n.NOTEQUAL);break;default:n.depthFunc(n.LEQUAL)}ge=j}},setLocked:function(j){N=j},setClear:function(j){le!==j&&(ie&&(j=1-j),n.clearDepth(j),le=j)},reset:function(){N=!1,oe=null,ge=null,le=null,ie=!1}}}function r(){let N=!1,ie=null,oe=null,ge=null,le=null,j=null,Ce=null,We=null,lt=null;return{setTest:function(it){N||(it?ee(n.STENCIL_TEST):pe(n.STENCIL_TEST))},setMask:function(it){ie!==it&&!N&&(n.stencilMask(it),ie=it)},setFunc:function(it,gi,ri){(oe!==it||ge!==gi||le!==ri)&&(n.stencilFunc(it,gi,ri),oe=it,ge=gi,le=ri)},setOp:function(it,gi,ri){(j!==it||Ce!==gi||We!==ri)&&(n.stencilOp(it,gi,ri),j=it,Ce=gi,We=ri)},setLocked:function(it){N=it},setClear:function(it){lt!==it&&(n.clearStencil(it),lt=it)},reset:function(){N=!1,ie=null,oe=null,ge=null,le=null,j=null,Ce=null,We=null,lt=null}}}let s=new t,o=new i,a=new r,l=new WeakMap,u=new WeakMap,h={},c={},f=new WeakMap,d=[],m=null,x=!1,y=null,p=null,_=null,g=null,v=null,M=null,S=null,E=new je(0,0,0),A=0,w=!1,T=null,b=null,L=null,D=null,F=null,U=n.getParameter(n.MAX_COMBINED_TEXTURE_IMAGE_UNITS),O=!1,Z=0,W=n.getParameter(n.VERSION);W.indexOf("WebGL")!==-1?(Z=parseFloat(/^WebGL (\d)/.exec(W)[1]),O=Z>=1):W.indexOf("OpenGL ES")!==-1&&(Z=parseFloat(/^OpenGL ES (\d)/.exec(W)[1]),O=Z>=2);let ne=null,re={},de=n.getParameter(n.SCISSOR_BOX),Ue=n.getParameter(n.VIEWPORT),He=new wt().fromArray(de),Ee=new wt().fromArray(Ue);function Ve(N,ie,oe,ge){let le=new Uint8Array(4),j=n.createTexture();n.bindTexture(N,j),n.texParameteri(N,n.TEXTURE_MIN_FILTER,n.NEAREST),n.texParameteri(N,n.TEXTURE_MAG_FILTER,n.NEAREST);for(let Ce=0;Ce<oe;Ce++)N===n.TEXTURE_3D||N===n.TEXTURE_2D_ARRAY?n.texImage3D(ie,0,n.RGBA,1,1,ge,0,n.RGBA,n.UNSIGNED_BYTE,le):n.texImage2D(ie+Ce,0,n.RGBA,1,1,0,n.RGBA,n.UNSIGNED_BYTE,le);return j}let q={};q[n.TEXTURE_2D]=Ve(n.TEXTURE_2D,n.TEXTURE_2D,1),q[n.TEXTURE_CUBE_MAP]=Ve(n.TEXTURE_CUBE_MAP,n.TEXTURE_CUBE_MAP_POSITIVE_X,6),q[n.TEXTURE_2D_ARRAY]=Ve(n.TEXTURE_2D_ARRAY,n.TEXTURE_2D_ARRAY,1,1),q[n.TEXTURE_3D]=Ve(n.TEXTURE_3D,n.TEXTURE_3D,1,1),s.setClear(0,0,0,1),o.setClear(1),a.setClear(0),ee(n.DEPTH_TEST),o.setFunc(Yr),H(!1),G(Dp),ee(n.CULL_FACE),qe(Bi);function ee(N){h[N]!==!0&&(n.enable(N),h[N]=!0)}function pe(N){h[N]!==!1&&(n.disable(N),h[N]=!1)}function Te(N,ie){return c[N]!==ie?(n.bindFramebuffer(N,ie),c[N]=ie,N===n.DRAW_FRAMEBUFFER&&(c[n.FRAMEBUFFER]=ie),N===n.FRAMEBUFFER&&(c[n.DRAW_FRAMEBUFFER]=ie),!0):!1}function ve(N,ie){let oe=d,ge=!1;if(N){oe=f.get(ie),oe===void 0&&(oe=[],f.set(ie,oe));let le=N.textures;if(oe.length!==le.length||oe[0]!==n.COLOR_ATTACHMENT0){for(let j=0,Ce=le.length;j<Ce;j++)oe[j]=n.COLOR_ATTACHMENT0+j;oe.length=le.length,ge=!0}}else oe[0]!==n.BACK&&(oe[0]=n.BACK,ge=!0);ge&&n.drawBuffers(oe)}function Xe(N){return m!==N?(n.useProgram(N),m=N,!0):!1}let Fe={[vr]:n.FUNC_ADD,[Fx]:n.FUNC_SUBTRACT,[Ox]:n.FUNC_REVERSE_SUBTRACT};Fe[Bx]=n.MIN,Fe[kx]=n.MAX;let I={[zx]:n.ZERO,[Vx]:n.ONE,[Hx]:n.SRC_COLOR,[Zc]:n.SRC_ALPHA,[$x]:n.SRC_ALPHA_SATURATE,[Yx]:n.DST_COLOR,[Wx]:n.DST_ALPHA,[Gx]:n.ONE_MINUS_SRC_COLOR,[Jc]:n.ONE_MINUS_SRC_ALPHA,[qx]:n.ONE_MINUS_DST_COLOR,[Xx]:n.ONE_MINUS_DST_ALPHA,[Zx]:n.CONSTANT_COLOR,[Jx]:n.ONE_MINUS_CONSTANT_COLOR,[Kx]:n.CONSTANT_ALPHA,[Qx]:n.ONE_MINUS_CONSTANT_ALPHA};function qe(N,ie,oe,ge,le,j,Ce,We,lt,it){if(N===Bi){x===!0&&(pe(n.BLEND),x=!1);return}if(x===!1&&(ee(n.BLEND),x=!0),N!==Ux){if(N!==y||it!==w){if((p!==vr||v!==vr)&&(n.blendEquation(n.FUNC_ADD),p=vr,v=vr),it)switch(N){case Xr:n.blendFuncSeparate(n.ONE,n.ONE_MINUS_SRC_ALPHA,n.ONE,n.ONE_MINUS_SRC_ALPHA);break;case Up:n.blendFunc(n.ONE,n.ONE);break;case Fp:n.blendFuncSeparate(n.ZERO,n.ONE_MINUS_SRC_COLOR,n.ZERO,n.ONE);break;case Op:n.blendFuncSeparate(n.DST_COLOR,n.ONE_MINUS_SRC_ALPHA,n.ZERO,n.ONE);break;default:console.error("THREE.WebGLState: Invalid blending: ",N);break}else switch(N){case Xr:n.blendFuncSeparate(n.SRC_ALPHA,n.ONE_MINUS_SRC_ALPHA,n.ONE,n.ONE_MINUS_SRC_ALPHA);break;case Up:n.blendFuncSeparate(n.SRC_ALPHA,n.ONE,n.ONE,n.ONE);break;case Fp:console.error("THREE.WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case Op:console.error("THREE.WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:console.error("THREE.WebGLState: Invalid blending: ",N);break}_=null,g=null,M=null,S=null,E.set(0,0,0),A=0,y=N,w=it}return}le=le||ie,j=j||oe,Ce=Ce||ge,(ie!==p||le!==v)&&(n.blendEquationSeparate(Fe[ie],Fe[le]),p=ie,v=le),(oe!==_||ge!==g||j!==M||Ce!==S)&&(n.blendFuncSeparate(I[oe],I[ge],I[j],I[Ce]),_=oe,g=ge,M=j,S=Ce),(We.equals(E)===!1||lt!==A)&&(n.blendColor(We.r,We.g,We.b,lt),E.copy(We),A=lt),y=N,w=!1}function De(N,ie){N.side===di?pe(n.CULL_FACE):ee(n.CULL_FACE);let oe=N.side===sn;ie&&(oe=!oe),H(oe),N.blending===Xr&&N.transparent===!1?qe(Bi):qe(N.blending,N.blendEquation,N.blendSrc,N.blendDst,N.blendEquationAlpha,N.blendSrcAlpha,N.blendDstAlpha,N.blendColor,N.blendAlpha,N.premultipliedAlpha),o.setFunc(N.depthFunc),o.setTest(N.depthTest),o.setMask(N.depthWrite),s.setMask(N.colorWrite);let ge=N.stencilWrite;a.setTest(ge),ge&&(a.setMask(N.stencilWriteMask),a.setFunc(N.stencilFunc,N.stencilRef,N.stencilFuncMask),a.setOp(N.stencilFail,N.stencilZFail,N.stencilZPass)),J(N.polygonOffset,N.polygonOffsetFactor,N.polygonOffsetUnits),N.alphaToCoverage===!0?ee(n.SAMPLE_ALPHA_TO_COVERAGE):pe(n.SAMPLE_ALPHA_TO_COVERAGE)}function H(N){T!==N&&(N?n.frontFace(n.CW):n.frontFace(n.CCW),T=N)}function G(N){N!==Dx?(ee(n.CULL_FACE),N!==b&&(N===Dp?n.cullFace(n.BACK):N===Nx?n.cullFace(n.FRONT):n.cullFace(n.FRONT_AND_BACK))):pe(n.CULL_FACE),b=N}function te(N){N!==L&&(O&&n.lineWidth(N),L=N)}function J(N,ie,oe){N?(ee(n.POLYGON_OFFSET_FILL),(D!==ie||F!==oe)&&(n.polygonOffset(ie,oe),D=ie,F=oe)):pe(n.POLYGON_OFFSET_FILL)}function fe(N){N?ee(n.SCISSOR_TEST):pe(n.SCISSOR_TEST)}function Ie(N){N===void 0&&(N=n.TEXTURE0+U-1),ne!==N&&(n.activeTexture(N),ne=N)}function _e(N,ie,oe){oe===void 0&&(ne===null?oe=n.TEXTURE0+U-1:oe=ne);let ge=re[oe];ge===void 0&&(ge={type:void 0,texture:void 0},re[oe]=ge),(ge.type!==N||ge.texture!==ie)&&(ne!==oe&&(n.activeTexture(oe),ne=oe),n.bindTexture(N,ie||q[N]),ge.type=N,ge.texture=ie)}function P(){let N=re[ne];N!==void 0&&N.type!==void 0&&(n.bindTexture(N.type,null),N.type=void 0,N.texture=void 0)}function C(){try{n.compressedTexImage2D(...arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function B(){try{n.compressedTexImage3D(...arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function K(){try{n.texSubImage2D(...arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function Q(){try{n.texSubImage3D(...arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function $(){try{n.compressedTexSubImage2D(...arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function Ae(){try{n.compressedTexSubImage3D(...arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function ue(){try{n.texStorage2D(...arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function be(){try{n.texStorage3D(...arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function Le(){try{n.texImage2D(...arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function se(){try{n.texImage3D(...arguments)}catch(N){console.error("THREE.WebGLState:",N)}}function ae(N){He.equals(N)===!1&&(n.scissor(N.x,N.y,N.z,N.w),He.copy(N))}function Be(N){Ee.equals(N)===!1&&(n.viewport(N.x,N.y,N.z,N.w),Ee.copy(N))}function Pe(N,ie){let oe=u.get(ie);oe===void 0&&(oe=new WeakMap,u.set(ie,oe));let ge=oe.get(N);ge===void 0&&(ge=n.getUniformBlockIndex(ie,N.name),oe.set(N,ge))}function me(N,ie){let ge=u.get(ie).get(N);l.get(ie)!==ge&&(n.uniformBlockBinding(ie,ge,N.__bindingPointIndex),l.set(ie,ge))}function Ye(){n.disable(n.BLEND),n.disable(n.CULL_FACE),n.disable(n.DEPTH_TEST),n.disable(n.POLYGON_OFFSET_FILL),n.disable(n.SCISSOR_TEST),n.disable(n.STENCIL_TEST),n.disable(n.SAMPLE_ALPHA_TO_COVERAGE),n.blendEquation(n.FUNC_ADD),n.blendFunc(n.ONE,n.ZERO),n.blendFuncSeparate(n.ONE,n.ZERO,n.ONE,n.ZERO),n.blendColor(0,0,0,0),n.colorMask(!0,!0,!0,!0),n.clearColor(0,0,0,0),n.depthMask(!0),n.depthFunc(n.LESS),o.setReversed(!1),n.clearDepth(1),n.stencilMask(4294967295),n.stencilFunc(n.ALWAYS,0,4294967295),n.stencilOp(n.KEEP,n.KEEP,n.KEEP),n.clearStencil(0),n.cullFace(n.BACK),n.frontFace(n.CCW),n.polygonOffset(0,0),n.activeTexture(n.TEXTURE0),n.bindFramebuffer(n.FRAMEBUFFER,null),n.bindFramebuffer(n.DRAW_FRAMEBUFFER,null),n.bindFramebuffer(n.READ_FRAMEBUFFER,null),n.useProgram(null),n.lineWidth(1),n.scissor(0,0,n.canvas.width,n.canvas.height),n.viewport(0,0,n.canvas.width,n.canvas.height),h={},ne=null,re={},c={},f=new WeakMap,d=[],m=null,x=!1,y=null,p=null,_=null,g=null,v=null,M=null,S=null,E=new je(0,0,0),A=0,w=!1,T=null,b=null,L=null,D=null,F=null,He.set(0,0,n.canvas.width,n.canvas.height),Ee.set(0,0,n.canvas.width,n.canvas.height),s.reset(),o.reset(),a.reset()}return{buffers:{color:s,depth:o,stencil:a},enable:ee,disable:pe,bindFramebuffer:Te,drawBuffers:ve,useProgram:Xe,setBlending:qe,setMaterial:De,setFlipSided:H,setCullFace:G,setLineWidth:te,setPolygonOffset:J,setScissorTest:fe,activeTexture:Ie,bindTexture:_e,unbindTexture:P,compressedTexImage2D:C,compressedTexImage3D:B,texImage2D:Le,texImage3D:se,updateUBOMapping:Pe,uniformBlockBinding:me,texStorage2D:ue,texStorage3D:be,texSubImage2D:K,texSubImage3D:Q,compressedTexSubImage2D:$,compressedTexSubImage3D:Ae,scissor:ae,viewport:Be,reset:Ye}}function cb(n,e,t,i,r,s,o){let a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),u=new Se,h=new WeakMap,c,f=new WeakMap,d=!1;try{d=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function m(P,C){return d?new OffscreenCanvas(P,C):Ea("canvas")}function x(P,C,B){let K=1,Q=_e(P);if((Q.width>B||Q.height>B)&&(K=B/Math.max(Q.width,Q.height)),K<1)if(typeof HTMLImageElement<"u"&&P instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&P instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&P instanceof ImageBitmap||typeof VideoFrame<"u"&&P instanceof VideoFrame){let $=Math.floor(K*Q.width),Ae=Math.floor(K*Q.height);c===void 0&&(c=m($,Ae));let ue=C?m($,Ae):c;return ue.width=$,ue.height=Ae,ue.getContext("2d").drawImage(P,0,0,$,Ae),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+Q.width+"x"+Q.height+") to ("+$+"x"+Ae+")."),ue}else return"data"in P&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+Q.width+"x"+Q.height+")."),P;return P}function y(P){return P.generateMipmaps}function p(P){n.generateMipmap(P)}function _(P){return P.isWebGLCubeRenderTarget?n.TEXTURE_CUBE_MAP:P.isWebGL3DRenderTarget?n.TEXTURE_3D:P.isWebGLArrayRenderTarget||P.isCompressedArrayTexture?n.TEXTURE_2D_ARRAY:n.TEXTURE_2D}function g(P,C,B,K,Q=!1){if(P!==null){if(n[P]!==void 0)return n[P];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+P+"'")}let $=C;if(C===n.RED&&(B===n.FLOAT&&($=n.R32F),B===n.HALF_FLOAT&&($=n.R16F),B===n.UNSIGNED_BYTE&&($=n.R8)),C===n.RED_INTEGER&&(B===n.UNSIGNED_BYTE&&($=n.R8UI),B===n.UNSIGNED_SHORT&&($=n.R16UI),B===n.UNSIGNED_INT&&($=n.R32UI),B===n.BYTE&&($=n.R8I),B===n.SHORT&&($=n.R16I),B===n.INT&&($=n.R32I)),C===n.RG&&(B===n.FLOAT&&($=n.RG32F),B===n.HALF_FLOAT&&($=n.RG16F),B===n.UNSIGNED_BYTE&&($=n.RG8)),C===n.RG_INTEGER&&(B===n.UNSIGNED_BYTE&&($=n.RG8UI),B===n.UNSIGNED_SHORT&&($=n.RG16UI),B===n.UNSIGNED_INT&&($=n.RG32UI),B===n.BYTE&&($=n.RG8I),B===n.SHORT&&($=n.RG16I),B===n.INT&&($=n.RG32I)),C===n.RGB_INTEGER&&(B===n.UNSIGNED_BYTE&&($=n.RGB8UI),B===n.UNSIGNED_SHORT&&($=n.RGB16UI),B===n.UNSIGNED_INT&&($=n.RGB32UI),B===n.BYTE&&($=n.RGB8I),B===n.SHORT&&($=n.RGB16I),B===n.INT&&($=n.RGB32I)),C===n.RGBA_INTEGER&&(B===n.UNSIGNED_BYTE&&($=n.RGBA8UI),B===n.UNSIGNED_SHORT&&($=n.RGBA16UI),B===n.UNSIGNED_INT&&($=n.RGBA32UI),B===n.BYTE&&($=n.RGBA8I),B===n.SHORT&&($=n.RGBA16I),B===n.INT&&($=n.RGBA32I)),C===n.RGB&&(B===n.UNSIGNED_INT_5_9_9_9_REV&&($=n.RGB9_E5),B===n.UNSIGNED_INT_10F_11F_11F_REV&&($=n.R11F_G11F_B10F)),C===n.RGBA){let Ae=Q?Ma:tt.getTransfer(K);B===n.FLOAT&&($=n.RGBA32F),B===n.HALF_FLOAT&&($=n.RGBA16F),B===n.UNSIGNED_BYTE&&($=Ae===st?n.SRGB8_ALPHA8:n.RGBA8),B===n.UNSIGNED_SHORT_4_4_4_4&&($=n.RGBA4),B===n.UNSIGNED_SHORT_5_5_5_1&&($=n.RGB5_A1)}return($===n.R16F||$===n.R32F||$===n.RG16F||$===n.RG32F||$===n.RGBA16F||$===n.RGBA32F)&&e.get("EXT_color_buffer_float"),$}function v(P,C){let B;return P?C===null||C===Mr||C===ho?B=n.DEPTH24_STENCIL8:C===pi?B=n.DEPTH32F_STENCIL8:C===co&&(B=n.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):C===null||C===Mr||C===ho?B=n.DEPTH_COMPONENT24:C===pi?B=n.DEPTH_COMPONENT32F:C===co&&(B=n.DEPTH_COMPONENT16),B}function M(P,C){return y(P)===!0||P.isFramebufferTexture&&P.minFilter!==kn&&P.minFilter!==jn?Math.log2(Math.max(C.width,C.height))+1:P.mipmaps!==void 0&&P.mipmaps.length>0?P.mipmaps.length:P.isCompressedTexture&&Array.isArray(P.image)?C.mipmaps.length:1}function S(P){let C=P.target;C.removeEventListener("dispose",S),A(C),C.isVideoTexture&&h.delete(C)}function E(P){let C=P.target;C.removeEventListener("dispose",E),T(C)}function A(P){let C=i.get(P);if(C.__webglInit===void 0)return;let B=P.source,K=f.get(B);if(K){let Q=K[C.__cacheKey];Q.usedTimes--,Q.usedTimes===0&&w(P),Object.keys(K).length===0&&f.delete(B)}i.remove(P)}function w(P){let C=i.get(P);n.deleteTexture(C.__webglTexture);let B=P.source,K=f.get(B);delete K[C.__cacheKey],o.memory.textures--}function T(P){let C=i.get(P);if(P.depthTexture&&(P.depthTexture.dispose(),i.remove(P.depthTexture)),P.isWebGLCubeRenderTarget)for(let K=0;K<6;K++){if(Array.isArray(C.__webglFramebuffer[K]))for(let Q=0;Q<C.__webglFramebuffer[K].length;Q++)n.deleteFramebuffer(C.__webglFramebuffer[K][Q]);else n.deleteFramebuffer(C.__webglFramebuffer[K]);C.__webglDepthbuffer&&n.deleteRenderbuffer(C.__webglDepthbuffer[K])}else{if(Array.isArray(C.__webglFramebuffer))for(let K=0;K<C.__webglFramebuffer.length;K++)n.deleteFramebuffer(C.__webglFramebuffer[K]);else n.deleteFramebuffer(C.__webglFramebuffer);if(C.__webglDepthbuffer&&n.deleteRenderbuffer(C.__webglDepthbuffer),C.__webglMultisampledFramebuffer&&n.deleteFramebuffer(C.__webglMultisampledFramebuffer),C.__webglColorRenderbuffer)for(let K=0;K<C.__webglColorRenderbuffer.length;K++)C.__webglColorRenderbuffer[K]&&n.deleteRenderbuffer(C.__webglColorRenderbuffer[K]);C.__webglDepthRenderbuffer&&n.deleteRenderbuffer(C.__webglDepthRenderbuffer)}let B=P.textures;for(let K=0,Q=B.length;K<Q;K++){let $=i.get(B[K]);$.__webglTexture&&(n.deleteTexture($.__webglTexture),o.memory.textures--),i.remove(B[K])}i.remove(P)}let b=0;function L(){b=0}function D(){let P=b;return P>=r.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+P+" texture units while this GPU supports only "+r.maxTextures),b+=1,P}function F(P){let C=[];return C.push(P.wrapS),C.push(P.wrapT),C.push(P.wrapR||0),C.push(P.magFilter),C.push(P.minFilter),C.push(P.anisotropy),C.push(P.internalFormat),C.push(P.format),C.push(P.type),C.push(P.generateMipmaps),C.push(P.premultiplyAlpha),C.push(P.flipY),C.push(P.unpackAlignment),C.push(P.colorSpace),C.join()}function U(P,C){let B=i.get(P);if(P.isVideoTexture&&fe(P),P.isRenderTargetTexture===!1&&P.isExternalTexture!==!0&&P.version>0&&B.__version!==P.version){let K=P.image;if(K===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(K.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{q(B,P,C);return}}else P.isExternalTexture&&(B.__webglTexture=P.sourceTexture?P.sourceTexture:null);t.bindTexture(n.TEXTURE_2D,B.__webglTexture,n.TEXTURE0+C)}function O(P,C){let B=i.get(P);if(P.isRenderTargetTexture===!1&&P.version>0&&B.__version!==P.version){q(B,P,C);return}t.bindTexture(n.TEXTURE_2D_ARRAY,B.__webglTexture,n.TEXTURE0+C)}function Z(P,C){let B=i.get(P);if(P.isRenderTargetTexture===!1&&P.version>0&&B.__version!==P.version){q(B,P,C);return}t.bindTexture(n.TEXTURE_3D,B.__webglTexture,n.TEXTURE0+C)}function W(P,C){let B=i.get(P);if(P.version>0&&B.__version!==P.version){ee(B,P,C);return}t.bindTexture(n.TEXTURE_CUBE_MAP,B.__webglTexture,n.TEXTURE0+C)}let ne={[Kc]:n.REPEAT,[gr]:n.CLAMP_TO_EDGE,[Qc]:n.MIRRORED_REPEAT},re={[kn]:n.NEAREST,[ly]:n.NEAREST_MIPMAP_NEAREST,[Ka]:n.NEAREST_MIPMAP_LINEAR,[jn]:n.LINEAR,[Nu]:n.LINEAR_MIPMAP_NEAREST,[Sr]:n.LINEAR_MIPMAP_LINEAR},de={[fy]:n.NEVER,[xy]:n.ALWAYS,[dy]:n.LESS,[Zp]:n.LEQUAL,[py]:n.EQUAL,[vy]:n.GEQUAL,[my]:n.GREATER,[gy]:n.NOTEQUAL};function Ue(P,C){if(C.type===pi&&e.has("OES_texture_float_linear")===!1&&(C.magFilter===jn||C.magFilter===Nu||C.magFilter===Ka||C.magFilter===Sr||C.minFilter===jn||C.minFilter===Nu||C.minFilter===Ka||C.minFilter===Sr)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),n.texParameteri(P,n.TEXTURE_WRAP_S,ne[C.wrapS]),n.texParameteri(P,n.TEXTURE_WRAP_T,ne[C.wrapT]),(P===n.TEXTURE_3D||P===n.TEXTURE_2D_ARRAY)&&n.texParameteri(P,n.TEXTURE_WRAP_R,ne[C.wrapR]),n.texParameteri(P,n.TEXTURE_MAG_FILTER,re[C.magFilter]),n.texParameteri(P,n.TEXTURE_MIN_FILTER,re[C.minFilter]),C.compareFunction&&(n.texParameteri(P,n.TEXTURE_COMPARE_MODE,n.COMPARE_REF_TO_TEXTURE),n.texParameteri(P,n.TEXTURE_COMPARE_FUNC,de[C.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(C.magFilter===kn||C.minFilter!==Ka&&C.minFilter!==Sr||C.type===pi&&e.has("OES_texture_float_linear")===!1)return;if(C.anisotropy>1||i.get(C).__currentAnisotropy){let B=e.get("EXT_texture_filter_anisotropic");n.texParameterf(P,B.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(C.anisotropy,r.getMaxAnisotropy())),i.get(C).__currentAnisotropy=C.anisotropy}}}function He(P,C){let B=!1;P.__webglInit===void 0&&(P.__webglInit=!0,C.addEventListener("dispose",S));let K=C.source,Q=f.get(K);Q===void 0&&(Q={},f.set(K,Q));let $=F(C);if($!==P.__cacheKey){Q[$]===void 0&&(Q[$]={texture:n.createTexture(),usedTimes:0},o.memory.textures++,B=!0),Q[$].usedTimes++;let Ae=Q[P.__cacheKey];Ae!==void 0&&(Q[P.__cacheKey].usedTimes--,Ae.usedTimes===0&&w(C)),P.__cacheKey=$,P.__webglTexture=Q[$].texture}return B}function Ee(P,C,B){return Math.floor(Math.floor(P/B)/C)}function Ve(P,C,B,K){let $=P.updateRanges;if($.length===0)t.texSubImage2D(n.TEXTURE_2D,0,0,0,C.width,C.height,B,K,C.data);else{$.sort((se,ae)=>se.start-ae.start);let Ae=0;for(let se=1;se<$.length;se++){let ae=$[Ae],Be=$[se],Pe=ae.start+ae.count,me=Ee(Be.start,C.width,4),Ye=Ee(ae.start,C.width,4);Be.start<=Pe+1&&me===Ye&&Ee(Be.start+Be.count-1,C.width,4)===me?ae.count=Math.max(ae.count,Be.start+Be.count-ae.start):(++Ae,$[Ae]=Be)}$.length=Ae+1;let ue=n.getParameter(n.UNPACK_ROW_LENGTH),be=n.getParameter(n.UNPACK_SKIP_PIXELS),Le=n.getParameter(n.UNPACK_SKIP_ROWS);n.pixelStorei(n.UNPACK_ROW_LENGTH,C.width);for(let se=0,ae=$.length;se<ae;se++){let Be=$[se],Pe=Math.floor(Be.start/4),me=Math.ceil(Be.count/4),Ye=Pe%C.width,N=Math.floor(Pe/C.width),ie=me,oe=1;n.pixelStorei(n.UNPACK_SKIP_PIXELS,Ye),n.pixelStorei(n.UNPACK_SKIP_ROWS,N),t.texSubImage2D(n.TEXTURE_2D,0,Ye,N,ie,oe,B,K,C.data)}P.clearUpdateRanges(),n.pixelStorei(n.UNPACK_ROW_LENGTH,ue),n.pixelStorei(n.UNPACK_SKIP_PIXELS,be),n.pixelStorei(n.UNPACK_SKIP_ROWS,Le)}}function q(P,C,B){let K=n.TEXTURE_2D;(C.isDataArrayTexture||C.isCompressedArrayTexture)&&(K=n.TEXTURE_2D_ARRAY),C.isData3DTexture&&(K=n.TEXTURE_3D);let Q=He(P,C),$=C.source;t.bindTexture(K,P.__webglTexture,n.TEXTURE0+B);let Ae=i.get($);if($.version!==Ae.__version||Q===!0){t.activeTexture(n.TEXTURE0+B);let ue=tt.getPrimaries(tt.workingColorSpace),be=C.colorSpace===zi?null:tt.getPrimaries(C.colorSpace),Le=C.colorSpace===zi||ue===be?n.NONE:n.BROWSER_DEFAULT_WEBGL;n.pixelStorei(n.UNPACK_FLIP_Y_WEBGL,C.flipY),n.pixelStorei(n.UNPACK_PREMULTIPLY_ALPHA_WEBGL,C.premultiplyAlpha),n.pixelStorei(n.UNPACK_ALIGNMENT,C.unpackAlignment),n.pixelStorei(n.UNPACK_COLORSPACE_CONVERSION_WEBGL,Le);let se=x(C.image,!1,r.maxTextureSize);se=Ie(C,se);let ae=s.convert(C.format,C.colorSpace),Be=s.convert(C.type),Pe=g(C.internalFormat,ae,Be,C.colorSpace,C.isVideoTexture);Ue(K,C);let me,Ye=C.mipmaps,N=C.isVideoTexture!==!0,ie=Ae.__version===void 0||Q===!0,oe=$.dataReady,ge=M(C,se);if(C.isDepthTexture)Pe=v(C.format===fo,C.type),ie&&(N?t.texStorage2D(n.TEXTURE_2D,1,Pe,se.width,se.height):t.texImage2D(n.TEXTURE_2D,0,Pe,se.width,se.height,0,ae,Be,null));else if(C.isDataTexture)if(Ye.length>0){N&&ie&&t.texStorage2D(n.TEXTURE_2D,ge,Pe,Ye[0].width,Ye[0].height);for(let le=0,j=Ye.length;le<j;le++)me=Ye[le],N?oe&&t.texSubImage2D(n.TEXTURE_2D,le,0,0,me.width,me.height,ae,Be,me.data):t.texImage2D(n.TEXTURE_2D,le,Pe,me.width,me.height,0,ae,Be,me.data);C.generateMipmaps=!1}else N?(ie&&t.texStorage2D(n.TEXTURE_2D,ge,Pe,se.width,se.height),oe&&Ve(C,se,ae,Be)):t.texImage2D(n.TEXTURE_2D,0,Pe,se.width,se.height,0,ae,Be,se.data);else if(C.isCompressedTexture)if(C.isCompressedArrayTexture){N&&ie&&t.texStorage3D(n.TEXTURE_2D_ARRAY,ge,Pe,Ye[0].width,Ye[0].height,se.depth);for(let le=0,j=Ye.length;le<j;le++)if(me=Ye[le],C.format!==zn)if(ae!==null)if(N){if(oe)if(C.layerUpdates.size>0){let Ce=nm(me.width,me.height,C.format,C.type);for(let We of C.layerUpdates){let lt=me.data.subarray(We*Ce/me.data.BYTES_PER_ELEMENT,(We+1)*Ce/me.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(n.TEXTURE_2D_ARRAY,le,0,0,We,me.width,me.height,1,ae,lt)}C.clearLayerUpdates()}else t.compressedTexSubImage3D(n.TEXTURE_2D_ARRAY,le,0,0,0,me.width,me.height,se.depth,ae,me.data)}else t.compressedTexImage3D(n.TEXTURE_2D_ARRAY,le,Pe,me.width,me.height,se.depth,0,me.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else N?oe&&t.texSubImage3D(n.TEXTURE_2D_ARRAY,le,0,0,0,me.width,me.height,se.depth,ae,Be,me.data):t.texImage3D(n.TEXTURE_2D_ARRAY,le,Pe,me.width,me.height,se.depth,0,ae,Be,me.data)}else{N&&ie&&t.texStorage2D(n.TEXTURE_2D,ge,Pe,Ye[0].width,Ye[0].height);for(let le=0,j=Ye.length;le<j;le++)me=Ye[le],C.format!==zn?ae!==null?N?oe&&t.compressedTexSubImage2D(n.TEXTURE_2D,le,0,0,me.width,me.height,ae,me.data):t.compressedTexImage2D(n.TEXTURE_2D,le,Pe,me.width,me.height,0,me.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):N?oe&&t.texSubImage2D(n.TEXTURE_2D,le,0,0,me.width,me.height,ae,Be,me.data):t.texImage2D(n.TEXTURE_2D,le,Pe,me.width,me.height,0,ae,Be,me.data)}else if(C.isDataArrayTexture)if(N){if(ie&&t.texStorage3D(n.TEXTURE_2D_ARRAY,ge,Pe,se.width,se.height,se.depth),oe)if(C.layerUpdates.size>0){let le=nm(se.width,se.height,C.format,C.type);for(let j of C.layerUpdates){let Ce=se.data.subarray(j*le/se.data.BYTES_PER_ELEMENT,(j+1)*le/se.data.BYTES_PER_ELEMENT);t.texSubImage3D(n.TEXTURE_2D_ARRAY,0,0,0,j,se.width,se.height,1,ae,Be,Ce)}C.clearLayerUpdates()}else t.texSubImage3D(n.TEXTURE_2D_ARRAY,0,0,0,0,se.width,se.height,se.depth,ae,Be,se.data)}else t.texImage3D(n.TEXTURE_2D_ARRAY,0,Pe,se.width,se.height,se.depth,0,ae,Be,se.data);else if(C.isData3DTexture)N?(ie&&t.texStorage3D(n.TEXTURE_3D,ge,Pe,se.width,se.height,se.depth),oe&&t.texSubImage3D(n.TEXTURE_3D,0,0,0,0,se.width,se.height,se.depth,ae,Be,se.data)):t.texImage3D(n.TEXTURE_3D,0,Pe,se.width,se.height,se.depth,0,ae,Be,se.data);else if(C.isFramebufferTexture){if(ie)if(N)t.texStorage2D(n.TEXTURE_2D,ge,Pe,se.width,se.height);else{let le=se.width,j=se.height;for(let Ce=0;Ce<ge;Ce++)t.texImage2D(n.TEXTURE_2D,Ce,Pe,le,j,0,ae,Be,null),le>>=1,j>>=1}}else if(Ye.length>0){if(N&&ie){let le=_e(Ye[0]);t.texStorage2D(n.TEXTURE_2D,ge,Pe,le.width,le.height)}for(let le=0,j=Ye.length;le<j;le++)me=Ye[le],N?oe&&t.texSubImage2D(n.TEXTURE_2D,le,0,0,ae,Be,me):t.texImage2D(n.TEXTURE_2D,le,Pe,ae,Be,me);C.generateMipmaps=!1}else if(N){if(ie){let le=_e(se);t.texStorage2D(n.TEXTURE_2D,ge,Pe,le.width,le.height)}oe&&t.texSubImage2D(n.TEXTURE_2D,0,0,0,ae,Be,se)}else t.texImage2D(n.TEXTURE_2D,0,Pe,ae,Be,se);y(C)&&p(K),Ae.__version=$.version,C.onUpdate&&C.onUpdate(C)}P.__version=C.version}function ee(P,C,B){if(C.image.length!==6)return;let K=He(P,C),Q=C.source;t.bindTexture(n.TEXTURE_CUBE_MAP,P.__webglTexture,n.TEXTURE0+B);let $=i.get(Q);if(Q.version!==$.__version||K===!0){t.activeTexture(n.TEXTURE0+B);let Ae=tt.getPrimaries(tt.workingColorSpace),ue=C.colorSpace===zi?null:tt.getPrimaries(C.colorSpace),be=C.colorSpace===zi||Ae===ue?n.NONE:n.BROWSER_DEFAULT_WEBGL;n.pixelStorei(n.UNPACK_FLIP_Y_WEBGL,C.flipY),n.pixelStorei(n.UNPACK_PREMULTIPLY_ALPHA_WEBGL,C.premultiplyAlpha),n.pixelStorei(n.UNPACK_ALIGNMENT,C.unpackAlignment),n.pixelStorei(n.UNPACK_COLORSPACE_CONVERSION_WEBGL,be);let Le=C.isCompressedTexture||C.image[0].isCompressedTexture,se=C.image[0]&&C.image[0].isDataTexture,ae=[];for(let j=0;j<6;j++)!Le&&!se?ae[j]=x(C.image[j],!0,r.maxCubemapSize):ae[j]=se?C.image[j].image:C.image[j],ae[j]=Ie(C,ae[j]);let Be=ae[0],Pe=s.convert(C.format,C.colorSpace),me=s.convert(C.type),Ye=g(C.internalFormat,Pe,me,C.colorSpace),N=C.isVideoTexture!==!0,ie=$.__version===void 0||K===!0,oe=Q.dataReady,ge=M(C,Be);Ue(n.TEXTURE_CUBE_MAP,C);let le;if(Le){N&&ie&&t.texStorage2D(n.TEXTURE_CUBE_MAP,ge,Ye,Be.width,Be.height);for(let j=0;j<6;j++){le=ae[j].mipmaps;for(let Ce=0;Ce<le.length;Ce++){let We=le[Ce];C.format!==zn?Pe!==null?N?oe&&t.compressedTexSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+j,Ce,0,0,We.width,We.height,Pe,We.data):t.compressedTexImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+j,Ce,Ye,We.width,We.height,0,We.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):N?oe&&t.texSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+j,Ce,0,0,We.width,We.height,Pe,me,We.data):t.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+j,Ce,Ye,We.width,We.height,0,Pe,me,We.data)}}}else{if(le=C.mipmaps,N&&ie){le.length>0&&ge++;let j=_e(ae[0]);t.texStorage2D(n.TEXTURE_CUBE_MAP,ge,Ye,j.width,j.height)}for(let j=0;j<6;j++)if(se){N?oe&&t.texSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,0,0,ae[j].width,ae[j].height,Pe,me,ae[j].data):t.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,Ye,ae[j].width,ae[j].height,0,Pe,me,ae[j].data);for(let Ce=0;Ce<le.length;Ce++){let lt=le[Ce].image[j].image;N?oe&&t.texSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+j,Ce+1,0,0,lt.width,lt.height,Pe,me,lt.data):t.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+j,Ce+1,Ye,lt.width,lt.height,0,Pe,me,lt.data)}}else{N?oe&&t.texSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,0,0,Pe,me,ae[j]):t.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,Ye,Pe,me,ae[j]);for(let Ce=0;Ce<le.length;Ce++){let We=le[Ce];N?oe&&t.texSubImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+j,Ce+1,0,0,Pe,me,We.image[j]):t.texImage2D(n.TEXTURE_CUBE_MAP_POSITIVE_X+j,Ce+1,Ye,Pe,me,We.image[j])}}}y(C)&&p(n.TEXTURE_CUBE_MAP),$.__version=Q.version,C.onUpdate&&C.onUpdate(C)}P.__version=C.version}function pe(P,C,B,K,Q,$){let Ae=s.convert(B.format,B.colorSpace),ue=s.convert(B.type),be=g(B.internalFormat,Ae,ue,B.colorSpace),Le=i.get(C),se=i.get(B);if(se.__renderTarget=C,!Le.__hasExternalTextures){let ae=Math.max(1,C.width>>$),Be=Math.max(1,C.height>>$);Q===n.TEXTURE_3D||Q===n.TEXTURE_2D_ARRAY?t.texImage3D(Q,$,be,ae,Be,C.depth,0,Ae,ue,null):t.texImage2D(Q,$,be,ae,Be,0,Ae,ue,null)}t.bindFramebuffer(n.FRAMEBUFFER,P),J(C)?a.framebufferTexture2DMultisampleEXT(n.FRAMEBUFFER,K,Q,se.__webglTexture,0,te(C)):(Q===n.TEXTURE_2D||Q>=n.TEXTURE_CUBE_MAP_POSITIVE_X&&Q<=n.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&n.framebufferTexture2D(n.FRAMEBUFFER,K,Q,se.__webglTexture,$),t.bindFramebuffer(n.FRAMEBUFFER,null)}function Te(P,C,B){if(n.bindRenderbuffer(n.RENDERBUFFER,P),C.depthBuffer){let K=C.depthTexture,Q=K&&K.isDepthTexture?K.type:null,$=v(C.stencilBuffer,Q),Ae=C.stencilBuffer?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT,ue=te(C);J(C)?a.renderbufferStorageMultisampleEXT(n.RENDERBUFFER,ue,$,C.width,C.height):B?n.renderbufferStorageMultisample(n.RENDERBUFFER,ue,$,C.width,C.height):n.renderbufferStorage(n.RENDERBUFFER,$,C.width,C.height),n.framebufferRenderbuffer(n.FRAMEBUFFER,Ae,n.RENDERBUFFER,P)}else{let K=C.textures;for(let Q=0;Q<K.length;Q++){let $=K[Q],Ae=s.convert($.format,$.colorSpace),ue=s.convert($.type),be=g($.internalFormat,Ae,ue,$.colorSpace),Le=te(C);B&&J(C)===!1?n.renderbufferStorageMultisample(n.RENDERBUFFER,Le,be,C.width,C.height):J(C)?a.renderbufferStorageMultisampleEXT(n.RENDERBUFFER,Le,be,C.width,C.height):n.renderbufferStorage(n.RENDERBUFFER,be,C.width,C.height)}}n.bindRenderbuffer(n.RENDERBUFFER,null)}function ve(P,C){if(C&&C.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(n.FRAMEBUFFER,P),!(C.depthTexture&&C.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let K=i.get(C.depthTexture);K.__renderTarget=C,(!K.__webglTexture||C.depthTexture.image.width!==C.width||C.depthTexture.image.height!==C.height)&&(C.depthTexture.image.width=C.width,C.depthTexture.image.height=C.height,C.depthTexture.needsUpdate=!0),U(C.depthTexture,0);let Q=K.__webglTexture,$=te(C);if(C.depthTexture.format===Qs)J(C)?a.framebufferTexture2DMultisampleEXT(n.FRAMEBUFFER,n.DEPTH_ATTACHMENT,n.TEXTURE_2D,Q,0,$):n.framebufferTexture2D(n.FRAMEBUFFER,n.DEPTH_ATTACHMENT,n.TEXTURE_2D,Q,0);else if(C.depthTexture.format===fo)J(C)?a.framebufferTexture2DMultisampleEXT(n.FRAMEBUFFER,n.DEPTH_STENCIL_ATTACHMENT,n.TEXTURE_2D,Q,0,$):n.framebufferTexture2D(n.FRAMEBUFFER,n.DEPTH_STENCIL_ATTACHMENT,n.TEXTURE_2D,Q,0);else throw new Error("Unknown depthTexture format")}function Xe(P){let C=i.get(P),B=P.isWebGLCubeRenderTarget===!0;if(C.__boundDepthTexture!==P.depthTexture){let K=P.depthTexture;if(C.__depthDisposeCallback&&C.__depthDisposeCallback(),K){let Q=()=>{delete C.__boundDepthTexture,delete C.__depthDisposeCallback,K.removeEventListener("dispose",Q)};K.addEventListener("dispose",Q),C.__depthDisposeCallback=Q}C.__boundDepthTexture=K}if(P.depthTexture&&!C.__autoAllocateDepthBuffer){if(B)throw new Error("target.depthTexture not supported in Cube render targets");let K=P.texture.mipmaps;K&&K.length>0?ve(C.__webglFramebuffer[0],P):ve(C.__webglFramebuffer,P)}else if(B){C.__webglDepthbuffer=[];for(let K=0;K<6;K++)if(t.bindFramebuffer(n.FRAMEBUFFER,C.__webglFramebuffer[K]),C.__webglDepthbuffer[K]===void 0)C.__webglDepthbuffer[K]=n.createRenderbuffer(),Te(C.__webglDepthbuffer[K],P,!1);else{let Q=P.stencilBuffer?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT,$=C.__webglDepthbuffer[K];n.bindRenderbuffer(n.RENDERBUFFER,$),n.framebufferRenderbuffer(n.FRAMEBUFFER,Q,n.RENDERBUFFER,$)}}else{let K=P.texture.mipmaps;if(K&&K.length>0?t.bindFramebuffer(n.FRAMEBUFFER,C.__webglFramebuffer[0]):t.bindFramebuffer(n.FRAMEBUFFER,C.__webglFramebuffer),C.__webglDepthbuffer===void 0)C.__webglDepthbuffer=n.createRenderbuffer(),Te(C.__webglDepthbuffer,P,!1);else{let Q=P.stencilBuffer?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT,$=C.__webglDepthbuffer;n.bindRenderbuffer(n.RENDERBUFFER,$),n.framebufferRenderbuffer(n.FRAMEBUFFER,Q,n.RENDERBUFFER,$)}}t.bindFramebuffer(n.FRAMEBUFFER,null)}function Fe(P,C,B){let K=i.get(P);C!==void 0&&pe(K.__webglFramebuffer,P,P.texture,n.COLOR_ATTACHMENT0,n.TEXTURE_2D,0),B!==void 0&&Xe(P)}function I(P){let C=P.texture,B=i.get(P),K=i.get(C);P.addEventListener("dispose",E);let Q=P.textures,$=P.isWebGLCubeRenderTarget===!0,Ae=Q.length>1;if(Ae||(K.__webglTexture===void 0&&(K.__webglTexture=n.createTexture()),K.__version=C.version,o.memory.textures++),$){B.__webglFramebuffer=[];for(let ue=0;ue<6;ue++)if(C.mipmaps&&C.mipmaps.length>0){B.__webglFramebuffer[ue]=[];for(let be=0;be<C.mipmaps.length;be++)B.__webglFramebuffer[ue][be]=n.createFramebuffer()}else B.__webglFramebuffer[ue]=n.createFramebuffer()}else{if(C.mipmaps&&C.mipmaps.length>0){B.__webglFramebuffer=[];for(let ue=0;ue<C.mipmaps.length;ue++)B.__webglFramebuffer[ue]=n.createFramebuffer()}else B.__webglFramebuffer=n.createFramebuffer();if(Ae)for(let ue=0,be=Q.length;ue<be;ue++){let Le=i.get(Q[ue]);Le.__webglTexture===void 0&&(Le.__webglTexture=n.createTexture(),o.memory.textures++)}if(P.samples>0&&J(P)===!1){B.__webglMultisampledFramebuffer=n.createFramebuffer(),B.__webglColorRenderbuffer=[],t.bindFramebuffer(n.FRAMEBUFFER,B.__webglMultisampledFramebuffer);for(let ue=0;ue<Q.length;ue++){let be=Q[ue];B.__webglColorRenderbuffer[ue]=n.createRenderbuffer(),n.bindRenderbuffer(n.RENDERBUFFER,B.__webglColorRenderbuffer[ue]);let Le=s.convert(be.format,be.colorSpace),se=s.convert(be.type),ae=g(be.internalFormat,Le,se,be.colorSpace,P.isXRRenderTarget===!0),Be=te(P);n.renderbufferStorageMultisample(n.RENDERBUFFER,Be,ae,P.width,P.height),n.framebufferRenderbuffer(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0+ue,n.RENDERBUFFER,B.__webglColorRenderbuffer[ue])}n.bindRenderbuffer(n.RENDERBUFFER,null),P.depthBuffer&&(B.__webglDepthRenderbuffer=n.createRenderbuffer(),Te(B.__webglDepthRenderbuffer,P,!0)),t.bindFramebuffer(n.FRAMEBUFFER,null)}}if($){t.bindTexture(n.TEXTURE_CUBE_MAP,K.__webglTexture),Ue(n.TEXTURE_CUBE_MAP,C);for(let ue=0;ue<6;ue++)if(C.mipmaps&&C.mipmaps.length>0)for(let be=0;be<C.mipmaps.length;be++)pe(B.__webglFramebuffer[ue][be],P,C,n.COLOR_ATTACHMENT0,n.TEXTURE_CUBE_MAP_POSITIVE_X+ue,be);else pe(B.__webglFramebuffer[ue],P,C,n.COLOR_ATTACHMENT0,n.TEXTURE_CUBE_MAP_POSITIVE_X+ue,0);y(C)&&p(n.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(Ae){for(let ue=0,be=Q.length;ue<be;ue++){let Le=Q[ue],se=i.get(Le),ae=n.TEXTURE_2D;(P.isWebGL3DRenderTarget||P.isWebGLArrayRenderTarget)&&(ae=P.isWebGL3DRenderTarget?n.TEXTURE_3D:n.TEXTURE_2D_ARRAY),t.bindTexture(ae,se.__webglTexture),Ue(ae,Le),pe(B.__webglFramebuffer,P,Le,n.COLOR_ATTACHMENT0+ue,ae,0),y(Le)&&p(ae)}t.unbindTexture()}else{let ue=n.TEXTURE_2D;if((P.isWebGL3DRenderTarget||P.isWebGLArrayRenderTarget)&&(ue=P.isWebGL3DRenderTarget?n.TEXTURE_3D:n.TEXTURE_2D_ARRAY),t.bindTexture(ue,K.__webglTexture),Ue(ue,C),C.mipmaps&&C.mipmaps.length>0)for(let be=0;be<C.mipmaps.length;be++)pe(B.__webglFramebuffer[be],P,C,n.COLOR_ATTACHMENT0,ue,be);else pe(B.__webglFramebuffer,P,C,n.COLOR_ATTACHMENT0,ue,0);y(C)&&p(ue),t.unbindTexture()}P.depthBuffer&&Xe(P)}function qe(P){let C=P.textures;for(let B=0,K=C.length;B<K;B++){let Q=C[B];if(y(Q)){let $=_(P),Ae=i.get(Q).__webglTexture;t.bindTexture($,Ae),p($),t.unbindTexture()}}}let De=[],H=[];function G(P){if(P.samples>0){if(J(P)===!1){let C=P.textures,B=P.width,K=P.height,Q=n.COLOR_BUFFER_BIT,$=P.stencilBuffer?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT,Ae=i.get(P),ue=C.length>1;if(ue)for(let Le=0;Le<C.length;Le++)t.bindFramebuffer(n.FRAMEBUFFER,Ae.__webglMultisampledFramebuffer),n.framebufferRenderbuffer(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0+Le,n.RENDERBUFFER,null),t.bindFramebuffer(n.FRAMEBUFFER,Ae.__webglFramebuffer),n.framebufferTexture2D(n.DRAW_FRAMEBUFFER,n.COLOR_ATTACHMENT0+Le,n.TEXTURE_2D,null,0);t.bindFramebuffer(n.READ_FRAMEBUFFER,Ae.__webglMultisampledFramebuffer);let be=P.texture.mipmaps;be&&be.length>0?t.bindFramebuffer(n.DRAW_FRAMEBUFFER,Ae.__webglFramebuffer[0]):t.bindFramebuffer(n.DRAW_FRAMEBUFFER,Ae.__webglFramebuffer);for(let Le=0;Le<C.length;Le++){if(P.resolveDepthBuffer&&(P.depthBuffer&&(Q|=n.DEPTH_BUFFER_BIT),P.stencilBuffer&&P.resolveStencilBuffer&&(Q|=n.STENCIL_BUFFER_BIT)),ue){n.framebufferRenderbuffer(n.READ_FRAMEBUFFER,n.COLOR_ATTACHMENT0,n.RENDERBUFFER,Ae.__webglColorRenderbuffer[Le]);let se=i.get(C[Le]).__webglTexture;n.framebufferTexture2D(n.DRAW_FRAMEBUFFER,n.COLOR_ATTACHMENT0,n.TEXTURE_2D,se,0)}n.blitFramebuffer(0,0,B,K,0,0,B,K,Q,n.NEAREST),l===!0&&(De.length=0,H.length=0,De.push(n.COLOR_ATTACHMENT0+Le),P.depthBuffer&&P.resolveDepthBuffer===!1&&(De.push($),H.push($),n.invalidateFramebuffer(n.DRAW_FRAMEBUFFER,H)),n.invalidateFramebuffer(n.READ_FRAMEBUFFER,De))}if(t.bindFramebuffer(n.READ_FRAMEBUFFER,null),t.bindFramebuffer(n.DRAW_FRAMEBUFFER,null),ue)for(let Le=0;Le<C.length;Le++){t.bindFramebuffer(n.FRAMEBUFFER,Ae.__webglMultisampledFramebuffer),n.framebufferRenderbuffer(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0+Le,n.RENDERBUFFER,Ae.__webglColorRenderbuffer[Le]);let se=i.get(C[Le]).__webglTexture;t.bindFramebuffer(n.FRAMEBUFFER,Ae.__webglFramebuffer),n.framebufferTexture2D(n.DRAW_FRAMEBUFFER,n.COLOR_ATTACHMENT0+Le,n.TEXTURE_2D,se,0)}t.bindFramebuffer(n.DRAW_FRAMEBUFFER,Ae.__webglMultisampledFramebuffer)}else if(P.depthBuffer&&P.resolveDepthBuffer===!1&&l){let C=P.stencilBuffer?n.DEPTH_STENCIL_ATTACHMENT:n.DEPTH_ATTACHMENT;n.invalidateFramebuffer(n.DRAW_FRAMEBUFFER,[C])}}}function te(P){return Math.min(r.maxSamples,P.samples)}function J(P){let C=i.get(P);return P.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&C.__useRenderToTexture!==!1}function fe(P){let C=o.render.frame;h.get(P)!==C&&(h.set(P,C),P.update())}function Ie(P,C){let B=P.colorSpace,K=P.format,Q=P.type;return P.isCompressedTexture===!0||P.isVideoTexture===!0||B!==qr&&B!==zi&&(tt.getTransfer(B)===st?(K!==zn||Q!==ii)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",B)),C}function _e(P){return typeof HTMLImageElement<"u"&&P instanceof HTMLImageElement?(u.width=P.naturalWidth||P.width,u.height=P.naturalHeight||P.height):typeof VideoFrame<"u"&&P instanceof VideoFrame?(u.width=P.displayWidth,u.height=P.displayHeight):(u.width=P.width,u.height=P.height),u}this.allocateTextureUnit=D,this.resetTextureUnits=L,this.setTexture2D=U,this.setTexture2DArray=O,this.setTexture3D=Z,this.setTextureCube=W,this.rebindTextures=Fe,this.setupRenderTarget=I,this.updateRenderTargetMipmap=qe,this.updateMultisampleRenderTarget=G,this.setupDepthRenderbuffer=Xe,this.setupFrameBufferTexture=pe,this.useMultisampledRTT=J}function ub(n,e){function t(i,r=zi){let s,o=tt.getTransfer(r);if(i===ii)return n.UNSIGNED_BYTE;if(i===Fu)return n.UNSIGNED_SHORT_4_4_4_4;if(i===Ou)return n.UNSIGNED_SHORT_5_5_5_1;if(i===Hp)return n.UNSIGNED_INT_5_9_9_9_REV;if(i===Gp)return n.UNSIGNED_INT_10F_11F_11F_REV;if(i===zp)return n.BYTE;if(i===Vp)return n.SHORT;if(i===co)return n.UNSIGNED_SHORT;if(i===Uu)return n.INT;if(i===Mr)return n.UNSIGNED_INT;if(i===pi)return n.FLOAT;if(i===uo)return n.HALF_FLOAT;if(i===Wp)return n.ALPHA;if(i===Xp)return n.RGB;if(i===zn)return n.RGBA;if(i===Qs)return n.DEPTH_COMPONENT;if(i===fo)return n.DEPTH_STENCIL;if(i===Yp)return n.RED;if(i===Bu)return n.RED_INTEGER;if(i===qp)return n.RG;if(i===ku)return n.RG_INTEGER;if(i===zu)return n.RGBA_INTEGER;if(i===Qa||i===ja||i===el||i===tl)if(o===st)if(s=e.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(i===Qa)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===ja)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===el)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===tl)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=e.get("WEBGL_compressed_texture_s3tc"),s!==null){if(i===Qa)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===ja)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===el)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===tl)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===Vu||i===Hu||i===Gu||i===Wu)if(s=e.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(i===Vu)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===Hu)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===Gu)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===Wu)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===Xu||i===Yu||i===qu)if(s=e.get("WEBGL_compressed_texture_etc"),s!==null){if(i===Xu||i===Yu)return o===st?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(i===qu)return o===st?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(i===$u||i===Zu||i===Ju||i===Ku||i===Qu||i===ju||i===eh||i===th||i===nh||i===ih||i===rh||i===sh||i===oh||i===ah)if(s=e.get("WEBGL_compressed_texture_astc"),s!==null){if(i===$u)return o===st?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===Zu)return o===st?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===Ju)return o===st?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===Ku)return o===st?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===Qu)return o===st?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===ju)return o===st?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===eh)return o===st?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===th)return o===st?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===nh)return o===st?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===ih)return o===st?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===rh)return o===st?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===sh)return o===st?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===oh)return o===st?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===ah)return o===st?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===lh||i===ch||i===uh)if(s=e.get("EXT_texture_compression_bptc"),s!==null){if(i===lh)return o===st?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===ch)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===uh)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===hh||i===fh||i===dh||i===ph)if(s=e.get("EXT_texture_compression_rgtc"),s!==null){if(i===hh)return s.COMPRESSED_RED_RGTC1_EXT;if(i===fh)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===dh)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===ph)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===ho?n.UNSIGNED_INT_24_8:n[i]!==void 0?n[i]:null}return{convert:t}}var hb=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,fb=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,mm=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){let i=new Ua(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=i}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,i=new ni({vertexShader:hb,fragmentShader:fb,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new rn(new Kr(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},gm=class extends Ui{constructor(e,t){super();let i=this,r=null,s=1,o=null,a="local-floor",l=1,u=null,h=null,c=null,f=null,d=null,m=null,x=typeof XRWebGLBinding<"u",y=new mm,p={},_=t.getContextAttributes(),g=null,v=null,M=[],S=[],E=new Se,A=null,w=new dn;w.viewport=new wt;let T=new dn;T.viewport=new wt;let b=[w,T],L=new wu,D=null,F=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(q){let ee=M[q];return ee===void 0&&(ee=new ro,M[q]=ee),ee.getTargetRaySpace()},this.getControllerGrip=function(q){let ee=M[q];return ee===void 0&&(ee=new ro,M[q]=ee),ee.getGripSpace()},this.getHand=function(q){let ee=M[q];return ee===void 0&&(ee=new ro,M[q]=ee),ee.getHandSpace()};function U(q){let ee=S.indexOf(q.inputSource);if(ee===-1)return;let pe=M[ee];pe!==void 0&&(pe.update(q.inputSource,q.frame,u||o),pe.dispatchEvent({type:q.type,data:q.inputSource}))}function O(){r.removeEventListener("select",U),r.removeEventListener("selectstart",U),r.removeEventListener("selectend",U),r.removeEventListener("squeeze",U),r.removeEventListener("squeezestart",U),r.removeEventListener("squeezeend",U),r.removeEventListener("end",O),r.removeEventListener("inputsourceschange",Z);for(let q=0;q<M.length;q++){let ee=S[q];ee!==null&&(S[q]=null,M[q].disconnect(ee))}D=null,F=null,y.reset();for(let q in p)delete p[q];e.setRenderTarget(g),d=null,f=null,c=null,r=null,v=null,Ve.stop(),i.isPresenting=!1,e.setPixelRatio(A),e.setSize(E.width,E.height,!1),i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(q){s=q,i.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(q){a=q,i.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return u||o},this.setReferenceSpace=function(q){u=q},this.getBaseLayer=function(){return f!==null?f:d},this.getBinding=function(){return c===null&&x&&(c=new XRWebGLBinding(r,t)),c},this.getFrame=function(){return m},this.getSession=function(){return r},this.setSession=async function(q){if(r=q,r!==null){if(g=e.getRenderTarget(),r.addEventListener("select",U),r.addEventListener("selectstart",U),r.addEventListener("selectend",U),r.addEventListener("squeeze",U),r.addEventListener("squeezestart",U),r.addEventListener("squeezeend",U),r.addEventListener("end",O),r.addEventListener("inputsourceschange",Z),_.xrCompatible!==!0&&await t.makeXRCompatible(),A=e.getPixelRatio(),e.getSize(E),x&&"createProjectionLayer"in XRWebGLBinding.prototype){let pe=null,Te=null,ve=null;_.depth&&(ve=_.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,pe=_.stencil?fo:Qs,Te=_.stencil?ho:Mr);let Xe={colorFormat:t.RGBA8,depthFormat:ve,scaleFactor:s};c=this.getBinding(),f=c.createProjectionLayer(Xe),r.updateRenderState({layers:[f]}),e.setPixelRatio(1),e.setSize(f.textureWidth,f.textureHeight,!1),v=new hi(f.textureWidth,f.textureHeight,{format:zn,type:ii,depthTexture:new Na(f.textureWidth,f.textureHeight,Te,void 0,void 0,void 0,void 0,void 0,void 0,pe),stencilBuffer:_.stencil,colorSpace:e.outputColorSpace,samples:_.antialias?4:0,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1})}else{let pe={antialias:_.antialias,alpha:!0,depth:_.depth,stencil:_.stencil,framebufferScaleFactor:s};d=new XRWebGLLayer(r,t,pe),r.updateRenderState({baseLayer:d}),e.setPixelRatio(1),e.setSize(d.framebufferWidth,d.framebufferHeight,!1),v=new hi(d.framebufferWidth,d.framebufferHeight,{format:zn,type:ii,colorSpace:e.outputColorSpace,stencilBuffer:_.stencil,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1})}v.isXRRenderTarget=!0,this.setFoveation(l),u=null,o=await r.requestReferenceSpace(a),Ve.setContext(r),Ve.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return y.getDepthTexture()};function Z(q){for(let ee=0;ee<q.removed.length;ee++){let pe=q.removed[ee],Te=S.indexOf(pe);Te>=0&&(S[Te]=null,M[Te].disconnect(pe))}for(let ee=0;ee<q.added.length;ee++){let pe=q.added[ee],Te=S.indexOf(pe);if(Te===-1){for(let Xe=0;Xe<M.length;Xe++)if(Xe>=S.length){S.push(pe),Te=Xe;break}else if(S[Xe]===null){S[Xe]=pe,Te=Xe;break}if(Te===-1)break}let ve=M[Te];ve&&ve.connect(pe)}}let W=new V,ne=new V;function re(q,ee,pe){W.setFromMatrixPosition(ee.matrixWorld),ne.setFromMatrixPosition(pe.matrixWorld);let Te=W.distanceTo(ne),ve=ee.projectionMatrix.elements,Xe=pe.projectionMatrix.elements,Fe=ve[14]/(ve[10]-1),I=ve[14]/(ve[10]+1),qe=(ve[9]+1)/ve[5],De=(ve[9]-1)/ve[5],H=(ve[8]-1)/ve[0],G=(Xe[8]+1)/Xe[0],te=Fe*H,J=Fe*G,fe=Te/(-H+G),Ie=fe*-H;if(ee.matrixWorld.decompose(q.position,q.quaternion,q.scale),q.translateX(Ie),q.translateZ(fe),q.matrixWorld.compose(q.position,q.quaternion,q.scale),q.matrixWorldInverse.copy(q.matrixWorld).invert(),ve[10]===-1)q.projectionMatrix.copy(ee.projectionMatrix),q.projectionMatrixInverse.copy(ee.projectionMatrixInverse);else{let _e=Fe+fe,P=I+fe,C=te-Ie,B=J+(Te-Ie),K=qe*I/P*_e,Q=De*I/P*_e;q.projectionMatrix.makePerspective(C,B,K,Q,_e,P),q.projectionMatrixInverse.copy(q.projectionMatrix).invert()}}function de(q,ee){ee===null?q.matrixWorld.copy(q.matrix):q.matrixWorld.multiplyMatrices(ee.matrixWorld,q.matrix),q.matrixWorldInverse.copy(q.matrixWorld).invert()}this.updateCamera=function(q){if(r===null)return;let ee=q.near,pe=q.far;y.texture!==null&&(y.depthNear>0&&(ee=y.depthNear),y.depthFar>0&&(pe=y.depthFar)),L.near=T.near=w.near=ee,L.far=T.far=w.far=pe,(D!==L.near||F!==L.far)&&(r.updateRenderState({depthNear:L.near,depthFar:L.far}),D=L.near,F=L.far),L.layers.mask=q.layers.mask|6,w.layers.mask=L.layers.mask&3,T.layers.mask=L.layers.mask&5;let Te=q.parent,ve=L.cameras;de(L,Te);for(let Xe=0;Xe<ve.length;Xe++)de(ve[Xe],Te);ve.length===2?re(L,w,T):L.projectionMatrix.copy(w.projectionMatrix),Ue(q,L,Te)};function Ue(q,ee,pe){pe===null?q.matrix.copy(ee.matrixWorld):(q.matrix.copy(pe.matrixWorld),q.matrix.invert(),q.matrix.multiply(ee.matrixWorld)),q.matrix.decompose(q.position,q.quaternion,q.scale),q.updateMatrixWorld(!0),q.projectionMatrix.copy(ee.projectionMatrix),q.projectionMatrixInverse.copy(ee.projectionMatrixInverse),q.isPerspectiveCamera&&(q.fov=eu*2*Math.atan(1/q.projectionMatrix.elements[5]),q.zoom=1)}this.getCamera=function(){return L},this.getFoveation=function(){if(!(f===null&&d===null))return l},this.setFoveation=function(q){l=q,f!==null&&(f.fixedFoveation=q),d!==null&&d.fixedFoveation!==void 0&&(d.fixedFoveation=q)},this.hasDepthSensing=function(){return y.texture!==null},this.getDepthSensingMesh=function(){return y.getMesh(L)},this.getCameraTexture=function(q){return p[q]};let He=null;function Ee(q,ee){if(h=ee.getViewerPose(u||o),m=ee,h!==null){let pe=h.views;d!==null&&(e.setRenderTargetFramebuffer(v,d.framebuffer),e.setRenderTarget(v));let Te=!1;pe.length!==L.cameras.length&&(L.cameras.length=0,Te=!0);for(let I=0;I<pe.length;I++){let qe=pe[I],De=null;if(d!==null)De=d.getViewport(qe);else{let G=c.getViewSubImage(f,qe);De=G.viewport,I===0&&(e.setRenderTargetTextures(v,G.colorTexture,G.depthStencilTexture),e.setRenderTarget(v))}let H=b[I];H===void 0&&(H=new dn,H.layers.enable(I),H.viewport=new wt,b[I]=H),H.matrix.fromArray(qe.transform.matrix),H.matrix.decompose(H.position,H.quaternion,H.scale),H.projectionMatrix.fromArray(qe.projectionMatrix),H.projectionMatrixInverse.copy(H.projectionMatrix).invert(),H.viewport.set(De.x,De.y,De.width,De.height),I===0&&(L.matrix.copy(H.matrix),L.matrix.decompose(L.position,L.quaternion,L.scale)),Te===!0&&L.cameras.push(H)}let ve=r.enabledFeatures;if(ve&&ve.includes("depth-sensing")&&r.depthUsage=="gpu-optimized"&&x){c=i.getBinding();let I=c.getDepthInformation(pe[0]);I&&I.isValid&&I.texture&&y.init(I,r.renderState)}if(ve&&ve.includes("camera-access")&&x){e.state.unbindTexture(),c=i.getBinding();for(let I=0;I<pe.length;I++){let qe=pe[I].camera;if(qe){let De=p[qe];De||(De=new Ua,p[qe]=De);let H=c.getCameraImage(qe);De.sourceTexture=H}}}}for(let pe=0;pe<M.length;pe++){let Te=S[pe],ve=M[pe];Te!==null&&ve!==void 0&&ve.update(Te,ee,u||o)}He&&He(q,ee),ee.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:ee}),m=null}let Ve=new Ky;Ve.setAnimationLoop(Ee),this.setAnimationLoop=function(q){He=q},this.dispose=function(){}}},rs=new ei,db=new Mt;function pb(n,e){function t(y,p){y.matrixAutoUpdate===!0&&y.updateMatrix(),p.value.copy(y.matrix)}function i(y,p){p.color.getRGB(y.fogColor.value,Qp(n)),p.isFog?(y.fogNear.value=p.near,y.fogFar.value=p.far):p.isFogExp2&&(y.fogDensity.value=p.density)}function r(y,p,_,g,v){p.isMeshBasicMaterial||p.isMeshLambertMaterial?s(y,p):p.isMeshToonMaterial?(s(y,p),c(y,p)):p.isMeshPhongMaterial?(s(y,p),h(y,p)):p.isMeshStandardMaterial?(s(y,p),f(y,p),p.isMeshPhysicalMaterial&&d(y,p,v)):p.isMeshMatcapMaterial?(s(y,p),m(y,p)):p.isMeshDepthMaterial?s(y,p):p.isMeshDistanceMaterial?(s(y,p),x(y,p)):p.isMeshNormalMaterial?s(y,p):p.isLineBasicMaterial?(o(y,p),p.isLineDashedMaterial&&a(y,p)):p.isPointsMaterial?l(y,p,_,g):p.isSpriteMaterial?u(y,p):p.isShadowMaterial?(y.color.value.copy(p.color),y.opacity.value=p.opacity):p.isShaderMaterial&&(p.uniformsNeedUpdate=!1)}function s(y,p){y.opacity.value=p.opacity,p.color&&y.diffuse.value.copy(p.color),p.emissive&&y.emissive.value.copy(p.emissive).multiplyScalar(p.emissiveIntensity),p.map&&(y.map.value=p.map,t(p.map,y.mapTransform)),p.alphaMap&&(y.alphaMap.value=p.alphaMap,t(p.alphaMap,y.alphaMapTransform)),p.bumpMap&&(y.bumpMap.value=p.bumpMap,t(p.bumpMap,y.bumpMapTransform),y.bumpScale.value=p.bumpScale,p.side===sn&&(y.bumpScale.value*=-1)),p.normalMap&&(y.normalMap.value=p.normalMap,t(p.normalMap,y.normalMapTransform),y.normalScale.value.copy(p.normalScale),p.side===sn&&y.normalScale.value.negate()),p.displacementMap&&(y.displacementMap.value=p.displacementMap,t(p.displacementMap,y.displacementMapTransform),y.displacementScale.value=p.displacementScale,y.displacementBias.value=p.displacementBias),p.emissiveMap&&(y.emissiveMap.value=p.emissiveMap,t(p.emissiveMap,y.emissiveMapTransform)),p.specularMap&&(y.specularMap.value=p.specularMap,t(p.specularMap,y.specularMapTransform)),p.alphaTest>0&&(y.alphaTest.value=p.alphaTest);let _=e.get(p),g=_.envMap,v=_.envMapRotation;g&&(y.envMap.value=g,rs.copy(v),rs.x*=-1,rs.y*=-1,rs.z*=-1,g.isCubeTexture&&g.isRenderTargetTexture===!1&&(rs.y*=-1,rs.z*=-1),y.envMapRotation.value.setFromMatrix4(db.makeRotationFromEuler(rs)),y.flipEnvMap.value=g.isCubeTexture&&g.isRenderTargetTexture===!1?-1:1,y.reflectivity.value=p.reflectivity,y.ior.value=p.ior,y.refractionRatio.value=p.refractionRatio),p.lightMap&&(y.lightMap.value=p.lightMap,y.lightMapIntensity.value=p.lightMapIntensity,t(p.lightMap,y.lightMapTransform)),p.aoMap&&(y.aoMap.value=p.aoMap,y.aoMapIntensity.value=p.aoMapIntensity,t(p.aoMap,y.aoMapTransform))}function o(y,p){y.diffuse.value.copy(p.color),y.opacity.value=p.opacity,p.map&&(y.map.value=p.map,t(p.map,y.mapTransform))}function a(y,p){y.dashSize.value=p.dashSize,y.totalSize.value=p.dashSize+p.gapSize,y.scale.value=p.scale}function l(y,p,_,g){y.diffuse.value.copy(p.color),y.opacity.value=p.opacity,y.size.value=p.size*_,y.scale.value=g*.5,p.map&&(y.map.value=p.map,t(p.map,y.uvTransform)),p.alphaMap&&(y.alphaMap.value=p.alphaMap,t(p.alphaMap,y.alphaMapTransform)),p.alphaTest>0&&(y.alphaTest.value=p.alphaTest)}function u(y,p){y.diffuse.value.copy(p.color),y.opacity.value=p.opacity,y.rotation.value=p.rotation,p.map&&(y.map.value=p.map,t(p.map,y.mapTransform)),p.alphaMap&&(y.alphaMap.value=p.alphaMap,t(p.alphaMap,y.alphaMapTransform)),p.alphaTest>0&&(y.alphaTest.value=p.alphaTest)}function h(y,p){y.specular.value.copy(p.specular),y.shininess.value=Math.max(p.shininess,1e-4)}function c(y,p){p.gradientMap&&(y.gradientMap.value=p.gradientMap)}function f(y,p){y.metalness.value=p.metalness,p.metalnessMap&&(y.metalnessMap.value=p.metalnessMap,t(p.metalnessMap,y.metalnessMapTransform)),y.roughness.value=p.roughness,p.roughnessMap&&(y.roughnessMap.value=p.roughnessMap,t(p.roughnessMap,y.roughnessMapTransform)),p.envMap&&(y.envMapIntensity.value=p.envMapIntensity)}function d(y,p,_){y.ior.value=p.ior,p.sheen>0&&(y.sheenColor.value.copy(p.sheenColor).multiplyScalar(p.sheen),y.sheenRoughness.value=p.sheenRoughness,p.sheenColorMap&&(y.sheenColorMap.value=p.sheenColorMap,t(p.sheenColorMap,y.sheenColorMapTransform)),p.sheenRoughnessMap&&(y.sheenRoughnessMap.value=p.sheenRoughnessMap,t(p.sheenRoughnessMap,y.sheenRoughnessMapTransform))),p.clearcoat>0&&(y.clearcoat.value=p.clearcoat,y.clearcoatRoughness.value=p.clearcoatRoughness,p.clearcoatMap&&(y.clearcoatMap.value=p.clearcoatMap,t(p.clearcoatMap,y.clearcoatMapTransform)),p.clearcoatRoughnessMap&&(y.clearcoatRoughnessMap.value=p.clearcoatRoughnessMap,t(p.clearcoatRoughnessMap,y.clearcoatRoughnessMapTransform)),p.clearcoatNormalMap&&(y.clearcoatNormalMap.value=p.clearcoatNormalMap,t(p.clearcoatNormalMap,y.clearcoatNormalMapTransform),y.clearcoatNormalScale.value.copy(p.clearcoatNormalScale),p.side===sn&&y.clearcoatNormalScale.value.negate())),p.dispersion>0&&(y.dispersion.value=p.dispersion),p.iridescence>0&&(y.iridescence.value=p.iridescence,y.iridescenceIOR.value=p.iridescenceIOR,y.iridescenceThicknessMinimum.value=p.iridescenceThicknessRange[0],y.iridescenceThicknessMaximum.value=p.iridescenceThicknessRange[1],p.iridescenceMap&&(y.iridescenceMap.value=p.iridescenceMap,t(p.iridescenceMap,y.iridescenceMapTransform)),p.iridescenceThicknessMap&&(y.iridescenceThicknessMap.value=p.iridescenceThicknessMap,t(p.iridescenceThicknessMap,y.iridescenceThicknessMapTransform))),p.transmission>0&&(y.transmission.value=p.transmission,y.transmissionSamplerMap.value=_.texture,y.transmissionSamplerSize.value.set(_.width,_.height),p.transmissionMap&&(y.transmissionMap.value=p.transmissionMap,t(p.transmissionMap,y.transmissionMapTransform)),y.thickness.value=p.thickness,p.thicknessMap&&(y.thicknessMap.value=p.thicknessMap,t(p.thicknessMap,y.thicknessMapTransform)),y.attenuationDistance.value=p.attenuationDistance,y.attenuationColor.value.copy(p.attenuationColor)),p.anisotropy>0&&(y.anisotropyVector.value.set(p.anisotropy*Math.cos(p.anisotropyRotation),p.anisotropy*Math.sin(p.anisotropyRotation)),p.anisotropyMap&&(y.anisotropyMap.value=p.anisotropyMap,t(p.anisotropyMap,y.anisotropyMapTransform))),y.specularIntensity.value=p.specularIntensity,y.specularColor.value.copy(p.specularColor),p.specularColorMap&&(y.specularColorMap.value=p.specularColorMap,t(p.specularColorMap,y.specularColorMapTransform)),p.specularIntensityMap&&(y.specularIntensityMap.value=p.specularIntensityMap,t(p.specularIntensityMap,y.specularIntensityMapTransform))}function m(y,p){p.matcap&&(y.matcap.value=p.matcap)}function x(y,p){let _=e.get(p).light;y.referencePosition.value.setFromMatrixPosition(_.matrixWorld),y.nearDistance.value=_.shadow.camera.near,y.farDistance.value=_.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:r}}function mb(n,e,t,i){let r={},s={},o=[],a=n.getParameter(n.MAX_UNIFORM_BUFFER_BINDINGS);function l(_,g){let v=g.program;i.uniformBlockBinding(_,v)}function u(_,g){let v=r[_.id];v===void 0&&(m(_),v=h(_),r[_.id]=v,_.addEventListener("dispose",y));let M=g.program;i.updateUBOMapping(_,M);let S=e.render.frame;s[_.id]!==S&&(f(_),s[_.id]=S)}function h(_){let g=c();_.__bindingPointIndex=g;let v=n.createBuffer(),M=_.__size,S=_.usage;return n.bindBuffer(n.UNIFORM_BUFFER,v),n.bufferData(n.UNIFORM_BUFFER,M,S),n.bindBuffer(n.UNIFORM_BUFFER,null),n.bindBufferBase(n.UNIFORM_BUFFER,g,v),v}function c(){for(let _=0;_<a;_++)if(o.indexOf(_)===-1)return o.push(_),_;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function f(_){let g=r[_.id],v=_.uniforms,M=_.__cache;n.bindBuffer(n.UNIFORM_BUFFER,g);for(let S=0,E=v.length;S<E;S++){let A=Array.isArray(v[S])?v[S]:[v[S]];for(let w=0,T=A.length;w<T;w++){let b=A[w];if(d(b,S,w,M)===!0){let L=b.__offset,D=Array.isArray(b.value)?b.value:[b.value],F=0;for(let U=0;U<D.length;U++){let O=D[U],Z=x(O);typeof O=="number"||typeof O=="boolean"?(b.__data[0]=O,n.bufferSubData(n.UNIFORM_BUFFER,L+F,b.__data)):O.isMatrix3?(b.__data[0]=O.elements[0],b.__data[1]=O.elements[1],b.__data[2]=O.elements[2],b.__data[3]=0,b.__data[4]=O.elements[3],b.__data[5]=O.elements[4],b.__data[6]=O.elements[5],b.__data[7]=0,b.__data[8]=O.elements[6],b.__data[9]=O.elements[7],b.__data[10]=O.elements[8],b.__data[11]=0):(O.toArray(b.__data,F),F+=Z.storage/Float32Array.BYTES_PER_ELEMENT)}n.bufferSubData(n.UNIFORM_BUFFER,L,b.__data)}}}n.bindBuffer(n.UNIFORM_BUFFER,null)}function d(_,g,v,M){let S=_.value,E=g+"_"+v;if(M[E]===void 0)return typeof S=="number"||typeof S=="boolean"?M[E]=S:M[E]=S.clone(),!0;{let A=M[E];if(typeof S=="number"||typeof S=="boolean"){if(A!==S)return M[E]=S,!0}else if(A.equals(S)===!1)return A.copy(S),!0}return!1}function m(_){let g=_.uniforms,v=0,M=16;for(let E=0,A=g.length;E<A;E++){let w=Array.isArray(g[E])?g[E]:[g[E]];for(let T=0,b=w.length;T<b;T++){let L=w[T],D=Array.isArray(L.value)?L.value:[L.value];for(let F=0,U=D.length;F<U;F++){let O=D[F],Z=x(O),W=v%M,ne=W%Z.boundary,re=W+ne;v+=ne,re!==0&&M-re<Z.storage&&(v+=M-re),L.__data=new Float32Array(Z.storage/Float32Array.BYTES_PER_ELEMENT),L.__offset=v,v+=Z.storage}}}let S=v%M;return S>0&&(v+=M-S),_.__size=v,_.__cache={},this}function x(_){let g={boundary:0,storage:0};return typeof _=="number"||typeof _=="boolean"?(g.boundary=4,g.storage=4):_.isVector2?(g.boundary=8,g.storage=8):_.isVector3||_.isColor?(g.boundary=16,g.storage=12):_.isVector4?(g.boundary=16,g.storage=16):_.isMatrix3?(g.boundary=48,g.storage=48):_.isMatrix4?(g.boundary=64,g.storage=64):_.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",_),g}function y(_){let g=_.target;g.removeEventListener("dispose",y);let v=o.indexOf(g.__bindingPointIndex);o.splice(v,1),n.deleteBuffer(r[g.id]),delete r[g.id],delete s[g.id]}function p(){for(let _ in r)n.deleteBuffer(r[_]);o=[],r={},s={}}return{bind:l,update:u,dispose:p}}var yh=class{constructor(e={}){let{canvas:t=yy(),context:i=null,depth:r=!0,stencil:s=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:u=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:c=!1,reversedDepthBuffer:f=!1}=e;this.isWebGLRenderer=!0;let d;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");d=i.getContextAttributes().alpha}else d=o;let m=new Uint32Array(4),x=new Int32Array(4),y=null,p=null,_=[],g=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=ki,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let v=this,M=!1;this._outputColorSpace=qt;let S=0,E=0,A=null,w=-1,T=null,b=new wt,L=new wt,D=null,F=new je(0),U=0,O=t.width,Z=t.height,W=1,ne=null,re=null,de=new wt(0,0,O,Z),Ue=new wt(0,0,O,Z),He=!1,Ee=new so,Ve=!1,q=!1,ee=new Mt,pe=new V,Te=new wt,ve={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},Xe=!1;function Fe(){return A===null?W:1}let I=i;function qe(R,k){return t.getContext(R,k)}try{let R={alpha:!0,depth:r,stencil:s,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:u,powerPreference:h,failIfMajorPerformanceCaveat:c};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${"180"}`),t.addEventListener("webglcontextlost",oe,!1),t.addEventListener("webglcontextrestored",ge,!1),t.addEventListener("webglcontextcreationerror",le,!1),I===null){let k="webgl2";if(I=qe(k,R),I===null)throw qe(k)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(R){throw console.error("THREE.WebGLRenderer: "+R.message),R}let De,H,G,te,J,fe,Ie,_e,P,C,B,K,Q,$,Ae,ue,be,Le,se,ae,Be,Pe,me,Ye;function N(){De=new DT(I),De.init(),Pe=new ub(I,De),H=new AT(I,De,e,Pe),G=new lb(I,De),H.reversedDepthBuffer&&f&&G.buffers.depth.setReversed(!0),te=new FT(I),J=new ZA,fe=new cb(I,De,G,J,H,Pe,te),Ie=new CT(v),_e=new LT(v),P=new H1(I),me=new ET(I,P),C=new NT(I,P,te,me),B=new BT(I,C,P,te),se=new OT(I,H,fe),ue=new bT(J),K=new $A(v,Ie,_e,De,H,me,ue),Q=new pb(v,J),$=new KA,Ae=new ib(De),Le=new wT(v,Ie,_e,G,B,d,l),be=new ob(v,B,H),Ye=new mb(I,te,H,G),ae=new TT(I,De,te),Be=new UT(I,De,te),te.programs=K.programs,v.capabilities=H,v.extensions=De,v.properties=J,v.renderLists=$,v.shadowMap=be,v.state=G,v.info=te}N();let ie=new gm(v,I);this.xr=ie,this.getContext=function(){return I},this.getContextAttributes=function(){return I.getContextAttributes()},this.forceContextLoss=function(){let R=De.get("WEBGL_lose_context");R&&R.loseContext()},this.forceContextRestore=function(){let R=De.get("WEBGL_lose_context");R&&R.restoreContext()},this.getPixelRatio=function(){return W},this.setPixelRatio=function(R){R!==void 0&&(W=R,this.setSize(O,Z,!1))},this.getSize=function(R){return R.set(O,Z)},this.setSize=function(R,k,X=!0){if(ie.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}O=R,Z=k,t.width=Math.floor(R*W),t.height=Math.floor(k*W),X===!0&&(t.style.width=R+"px",t.style.height=k+"px"),this.setViewport(0,0,R,k)},this.getDrawingBufferSize=function(R){return R.set(O*W,Z*W).floor()},this.setDrawingBufferSize=function(R,k,X){O=R,Z=k,W=X,t.width=Math.floor(R*X),t.height=Math.floor(k*X),this.setViewport(0,0,R,k)},this.getCurrentViewport=function(R){return R.copy(b)},this.getViewport=function(R){return R.copy(de)},this.setViewport=function(R,k,X,Y){R.isVector4?de.set(R.x,R.y,R.z,R.w):de.set(R,k,X,Y),G.viewport(b.copy(de).multiplyScalar(W).round())},this.getScissor=function(R){return R.copy(Ue)},this.setScissor=function(R,k,X,Y){R.isVector4?Ue.set(R.x,R.y,R.z,R.w):Ue.set(R,k,X,Y),G.scissor(L.copy(Ue).multiplyScalar(W).round())},this.getScissorTest=function(){return He},this.setScissorTest=function(R){G.setScissorTest(He=R)},this.setOpaqueSort=function(R){ne=R},this.setTransparentSort=function(R){re=R},this.getClearColor=function(R){return R.copy(Le.getClearColor())},this.setClearColor=function(){Le.setClearColor(...arguments)},this.getClearAlpha=function(){return Le.getClearAlpha()},this.setClearAlpha=function(){Le.setClearAlpha(...arguments)},this.clear=function(R=!0,k=!0,X=!0){let Y=0;if(R){let z=!1;if(A!==null){let he=A.texture.format;z=he===zu||he===ku||he===Bu}if(z){let he=A.texture.type,ye=he===ii||he===Mr||he===co||he===ho||he===Fu||he===Ou,Re=Le.getClearColor(),we=Le.getClearAlpha(),ze=Re.r,Ge=Re.g,Oe=Re.b;ye?(m[0]=ze,m[1]=Ge,m[2]=Oe,m[3]=we,I.clearBufferuiv(I.COLOR,0,m)):(x[0]=ze,x[1]=Ge,x[2]=Oe,x[3]=we,I.clearBufferiv(I.COLOR,0,x))}else Y|=I.COLOR_BUFFER_BIT}k&&(Y|=I.DEPTH_BUFFER_BIT),X&&(Y|=I.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),I.clear(Y)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",oe,!1),t.removeEventListener("webglcontextrestored",ge,!1),t.removeEventListener("webglcontextcreationerror",le,!1),Le.dispose(),$.dispose(),Ae.dispose(),J.dispose(),Ie.dispose(),_e.dispose(),B.dispose(),me.dispose(),Ye.dispose(),K.dispose(),ie.dispose(),ie.removeEventListener("sessionstart",ri),ie.removeEventListener("sessionend",ym),wr.stop()};function oe(R){R.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),M=!0}function ge(){console.log("THREE.WebGLRenderer: Context Restored."),M=!1;let R=te.autoReset,k=be.enabled,X=be.autoUpdate,Y=be.needsUpdate,z=be.type;N(),te.autoReset=R,be.enabled=k,be.autoUpdate=X,be.needsUpdate=Y,be.type=z}function le(R){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",R.statusMessage)}function j(R){let k=R.target;k.removeEventListener("dispose",j),Ce(k)}function Ce(R){We(R),J.remove(R)}function We(R){let k=J.get(R).programs;k!==void 0&&(k.forEach(function(X){K.releaseProgram(X)}),R.isShaderMaterial&&K.releaseShaderCache(R))}this.renderBufferDirect=function(R,k,X,Y,z,he){k===null&&(k=ve);let ye=z.isMesh&&z.matrixWorld.determinant()<0,Re=c_(R,k,X,Y,z);G.setMaterial(Y,ye);let we=X.index,ze=1;if(Y.wireframe===!0){if(we=C.getWireframeAttribute(X),we===void 0)return;ze=2}let Ge=X.drawRange,Oe=X.attributes.position,Qe=Ge.start*ze,ot=(Ge.start+Ge.count)*ze;he!==null&&(Qe=Math.max(Qe,he.start*ze),ot=Math.min(ot,(he.start+he.count)*ze)),we!==null?(Qe=Math.max(Qe,0),ot=Math.min(ot,we.count)):Oe!=null&&(Qe=Math.max(Qe,0),ot=Math.min(ot,Oe.count));let Et=ot-Qe;if(Et<0||Et===1/0)return;me.setup(z,Y,Re,X,we);let ht,at=ae;if(we!==null&&(ht=P.get(we),at=Be,at.setIndex(ht)),z.isMesh)Y.wireframe===!0?(G.setLineWidth(Y.wireframeLinewidth*Fe()),at.setMode(I.LINES)):at.setMode(I.TRIANGLES);else if(z.isLine){let ke=Y.linewidth;ke===void 0&&(ke=1),G.setLineWidth(ke*Fe()),z.isLineSegments?at.setMode(I.LINES):z.isLineLoop?at.setMode(I.LINE_LOOP):at.setMode(I.LINE_STRIP)}else z.isPoints?at.setMode(I.POINTS):z.isSprite&&at.setMode(I.TRIANGLES);if(z.isBatchedMesh)if(z._multiDrawInstances!==null)js("THREE.WebGLRenderer: renderMultiDrawInstances has been deprecated and will be removed in r184. Append to renderMultiDraw arguments and use indirection."),at.renderMultiDrawInstances(z._multiDrawStarts,z._multiDrawCounts,z._multiDrawCount,z._multiDrawInstances);else if(De.get("WEBGL_multi_draw"))at.renderMultiDraw(z._multiDrawStarts,z._multiDrawCounts,z._multiDrawCount);else{let ke=z._multiDrawStarts,gt=z._multiDrawCounts,nt=z._multiDrawCount,mn=we?P.get(we).bytesPerElement:1,as=J.get(Y).currentProgram.getUniforms();for(let gn=0;gn<nt;gn++)as.setValue(I,"_gl_DrawID",gn),at.render(ke[gn]/mn,gt[gn])}else if(z.isInstancedMesh)at.renderInstances(Qe,Et,z.count);else if(X.isInstancedBufferGeometry){let ke=X._maxInstanceCount!==void 0?X._maxInstanceCount:1/0,gt=Math.min(X.instanceCount,ke);at.renderInstances(Qe,Et,gt)}else at.render(Qe,Et)};function lt(R,k,X){R.transparent===!0&&R.side===di&&R.forceSinglePass===!1?(R.side=sn,R.needsUpdate=!0,rl(R,k,X),R.side=Ni,R.needsUpdate=!0,rl(R,k,X),R.side=di):rl(R,k,X)}this.compile=function(R,k,X=null){X===null&&(X=R),p=Ae.get(X),p.init(k),g.push(p),X.traverseVisible(function(z){z.isLight&&z.layers.test(k.layers)&&(p.pushLight(z),z.castShadow&&p.pushShadow(z))}),R!==X&&R.traverseVisible(function(z){z.isLight&&z.layers.test(k.layers)&&(p.pushLight(z),z.castShadow&&p.pushShadow(z))}),p.setupLights();let Y=new Set;return R.traverse(function(z){if(!(z.isMesh||z.isPoints||z.isLine||z.isSprite))return;let he=z.material;if(he)if(Array.isArray(he))for(let ye=0;ye<he.length;ye++){let Re=he[ye];lt(Re,X,z),Y.add(Re)}else lt(he,X,z),Y.add(he)}),p=g.pop(),Y},this.compileAsync=function(R,k,X=null){let Y=this.compile(R,k,X);return new Promise(z=>{function he(){if(Y.forEach(function(ye){J.get(ye).currentProgram.isReady()&&Y.delete(ye)}),Y.size===0){z(R);return}setTimeout(he,10)}De.get("KHR_parallel_shader_compile")!==null?he():setTimeout(he,10)})};let it=null;function gi(R){it&&it(R)}function ri(){wr.stop()}function ym(){wr.start()}let wr=new Ky;wr.setAnimationLoop(gi),typeof self<"u"&&wr.setContext(self),this.setAnimationLoop=function(R){it=R,ie.setAnimationLoop(R),R===null?wr.stop():wr.start()},ie.addEventListener("sessionstart",ri),ie.addEventListener("sessionend",ym),this.render=function(R,k){if(k!==void 0&&k.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(M===!0)return;if(R.matrixWorldAutoUpdate===!0&&R.updateMatrixWorld(),k.parent===null&&k.matrixWorldAutoUpdate===!0&&k.updateMatrixWorld(),ie.enabled===!0&&ie.isPresenting===!0&&(ie.cameraAutoUpdate===!0&&ie.updateCamera(k),k=ie.getCamera()),R.isScene===!0&&R.onBeforeRender(v,R,k,A),p=Ae.get(R,g.length),p.init(k),g.push(p),ee.multiplyMatrices(k.projectionMatrix,k.matrixWorldInverse),Ee.setFromProjectionMatrix(ee,Qn,k.reversedDepth),q=this.localClippingEnabled,Ve=ue.init(this.clippingPlanes,q),y=$.get(R,_.length),y.init(),_.push(y),ie.enabled===!0&&ie.isPresenting===!0){let he=v.xr.getDepthSensingMesh();he!==null&&wh(he,k,-1/0,v.sortObjects)}wh(R,k,0,v.sortObjects),y.finish(),v.sortObjects===!0&&y.sort(ne,re),Xe=ie.enabled===!1||ie.isPresenting===!1||ie.hasDepthSensing()===!1,Xe&&Le.addToRenderList(y,R),this.info.render.frame++,Ve===!0&&ue.beginShadows();let X=p.state.shadowsArray;be.render(X,R,k),Ve===!0&&ue.endShadows(),this.info.autoReset===!0&&this.info.reset();let Y=y.opaque,z=y.transmissive;if(p.setupLights(),k.isArrayCamera){let he=k.cameras;if(z.length>0)for(let ye=0,Re=he.length;ye<Re;ye++){let we=he[ye];Sm(Y,z,R,we)}Xe&&Le.render(R);for(let ye=0,Re=he.length;ye<Re;ye++){let we=he[ye];_m(y,R,we,we.viewport)}}else z.length>0&&Sm(Y,z,R,k),Xe&&Le.render(R),_m(y,R,k);A!==null&&E===0&&(fe.updateMultisampleRenderTarget(A),fe.updateRenderTargetMipmap(A)),R.isScene===!0&&R.onAfterRender(v,R,k),me.resetDefaultState(),w=-1,T=null,g.pop(),g.length>0?(p=g[g.length-1],Ve===!0&&ue.setGlobalState(v.clippingPlanes,p.state.camera)):p=null,_.pop(),_.length>0?y=_[_.length-1]:y=null};function wh(R,k,X,Y){if(R.visible===!1)return;if(R.layers.test(k.layers)){if(R.isGroup)X=R.renderOrder;else if(R.isLOD)R.autoUpdate===!0&&R.update(k);else if(R.isLight)p.pushLight(R),R.castShadow&&p.pushShadow(R);else if(R.isSprite){if(!R.frustumCulled||Ee.intersectsSprite(R)){Y&&Te.setFromMatrixPosition(R.matrixWorld).applyMatrix4(ee);let ye=B.update(R),Re=R.material;Re.visible&&y.push(R,ye,Re,X,Te.z,null)}}else if((R.isMesh||R.isLine||R.isPoints)&&(!R.frustumCulled||Ee.intersectsObject(R))){let ye=B.update(R),Re=R.material;if(Y&&(R.boundingSphere!==void 0?(R.boundingSphere===null&&R.computeBoundingSphere(),Te.copy(R.boundingSphere.center)):(ye.boundingSphere===null&&ye.computeBoundingSphere(),Te.copy(ye.boundingSphere.center)),Te.applyMatrix4(R.matrixWorld).applyMatrix4(ee)),Array.isArray(Re)){let we=ye.groups;for(let ze=0,Ge=we.length;ze<Ge;ze++){let Oe=we[ze],Qe=Re[Oe.materialIndex];Qe&&Qe.visible&&y.push(R,ye,Qe,X,Te.z,Oe)}}else Re.visible&&y.push(R,ye,Re,X,Te.z,null)}}let he=R.children;for(let ye=0,Re=he.length;ye<Re;ye++)wh(he[ye],k,X,Y)}function _m(R,k,X,Y){let z=R.opaque,he=R.transmissive,ye=R.transparent;p.setupLightsView(X),Ve===!0&&ue.setGlobalState(v.clippingPlanes,X),Y&&G.viewport(b.copy(Y)),z.length>0&&il(z,k,X),he.length>0&&il(he,k,X),ye.length>0&&il(ye,k,X),G.buffers.depth.setTest(!0),G.buffers.depth.setMask(!0),G.buffers.color.setMask(!0),G.setPolygonOffset(!1)}function Sm(R,k,X,Y){if((X.isScene===!0?X.overrideMaterial:null)!==null)return;p.state.transmissionRenderTarget[Y.id]===void 0&&(p.state.transmissionRenderTarget[Y.id]=new hi(1,1,{generateMipmaps:!0,type:De.has("EXT_color_buffer_half_float")||De.has("EXT_color_buffer_float")?uo:ii,minFilter:Sr,samples:4,stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:tt.workingColorSpace}));let he=p.state.transmissionRenderTarget[Y.id],ye=Y.viewport||b;he.setSize(ye.z*v.transmissionResolutionScale,ye.w*v.transmissionResolutionScale);let Re=v.getRenderTarget(),we=v.getActiveCubeFace(),ze=v.getActiveMipmapLevel();v.setRenderTarget(he),v.getClearColor(F),U=v.getClearAlpha(),U<1&&v.setClearColor(16777215,.5),v.clear(),Xe&&Le.render(X);let Ge=v.toneMapping;v.toneMapping=ki;let Oe=Y.viewport;if(Y.viewport!==void 0&&(Y.viewport=void 0),p.setupLightsView(Y),Ve===!0&&ue.setGlobalState(v.clippingPlanes,Y),il(R,X,Y),fe.updateMultisampleRenderTarget(he),fe.updateRenderTargetMipmap(he),De.has("WEBGL_multisampled_render_to_texture")===!1){let Qe=!1;for(let ot=0,Et=k.length;ot<Et;ot++){let ht=k[ot],at=ht.object,ke=ht.geometry,gt=ht.material,nt=ht.group;if(gt.side===di&&at.layers.test(Y.layers)){let mn=gt.side;gt.side=sn,gt.needsUpdate=!0,Mm(at,X,Y,ke,gt,nt),gt.side=mn,gt.needsUpdate=!0,Qe=!0}}Qe===!0&&(fe.updateMultisampleRenderTarget(he),fe.updateRenderTargetMipmap(he))}v.setRenderTarget(Re,we,ze),v.setClearColor(F,U),Oe!==void 0&&(Y.viewport=Oe),v.toneMapping=Ge}function il(R,k,X){let Y=k.isScene===!0?k.overrideMaterial:null;for(let z=0,he=R.length;z<he;z++){let ye=R[z],Re=ye.object,we=ye.geometry,ze=ye.group,Ge=ye.material;Ge.allowOverride===!0&&Y!==null&&(Ge=Y),Re.layers.test(X.layers)&&Mm(Re,k,X,we,Ge,ze)}}function Mm(R,k,X,Y,z,he){R.onBeforeRender(v,k,X,Y,z,he),R.modelViewMatrix.multiplyMatrices(X.matrixWorldInverse,R.matrixWorld),R.normalMatrix.getNormalMatrix(R.modelViewMatrix),z.onBeforeRender(v,k,X,Y,R,he),z.transparent===!0&&z.side===di&&z.forceSinglePass===!1?(z.side=sn,z.needsUpdate=!0,v.renderBufferDirect(X,k,Y,z,R,he),z.side=Ni,z.needsUpdate=!0,v.renderBufferDirect(X,k,Y,z,R,he),z.side=di):v.renderBufferDirect(X,k,Y,z,R,he),R.onAfterRender(v,k,X,Y,z,he)}function rl(R,k,X){k.isScene!==!0&&(k=ve);let Y=J.get(R),z=p.state.lights,he=p.state.shadowsArray,ye=z.state.version,Re=K.getParameters(R,z.state,he,k,X),we=K.getProgramCacheKey(Re),ze=Y.programs;Y.environment=R.isMeshStandardMaterial?k.environment:null,Y.fog=k.fog,Y.envMap=(R.isMeshStandardMaterial?_e:Ie).get(R.envMap||Y.environment),Y.envMapRotation=Y.environment!==null&&R.envMap===null?k.environmentRotation:R.envMapRotation,ze===void 0&&(R.addEventListener("dispose",j),ze=new Map,Y.programs=ze);let Ge=ze.get(we);if(Ge!==void 0){if(Y.currentProgram===Ge&&Y.lightsStateVersion===ye)return Em(R,Re),Ge}else Re.uniforms=K.getUniforms(R),R.onBeforeCompile(Re,v),Ge=K.acquireProgram(Re,we),ze.set(we,Ge),Y.uniforms=Re.uniforms;let Oe=Y.uniforms;return(!R.isShaderMaterial&&!R.isRawShaderMaterial||R.clipping===!0)&&(Oe.clippingPlanes=ue.uniform),Em(R,Re),Y.needsLights=h_(R),Y.lightsStateVersion=ye,Y.needsLights&&(Oe.ambientLightColor.value=z.state.ambient,Oe.lightProbe.value=z.state.probe,Oe.directionalLights.value=z.state.directional,Oe.directionalLightShadows.value=z.state.directionalShadow,Oe.spotLights.value=z.state.spot,Oe.spotLightShadows.value=z.state.spotShadow,Oe.rectAreaLights.value=z.state.rectArea,Oe.ltc_1.value=z.state.rectAreaLTC1,Oe.ltc_2.value=z.state.rectAreaLTC2,Oe.pointLights.value=z.state.point,Oe.pointLightShadows.value=z.state.pointShadow,Oe.hemisphereLights.value=z.state.hemi,Oe.directionalShadowMap.value=z.state.directionalShadowMap,Oe.directionalShadowMatrix.value=z.state.directionalShadowMatrix,Oe.spotShadowMap.value=z.state.spotShadowMap,Oe.spotLightMatrix.value=z.state.spotLightMatrix,Oe.spotLightMap.value=z.state.spotLightMap,Oe.pointShadowMap.value=z.state.pointShadowMap,Oe.pointShadowMatrix.value=z.state.pointShadowMatrix),Y.currentProgram=Ge,Y.uniformsList=null,Ge}function wm(R){if(R.uniformsList===null){let k=R.currentProgram.getUniforms();R.uniformsList=vo.seqWithValue(k.seq,R.uniforms)}return R.uniformsList}function Em(R,k){let X=J.get(R);X.outputColorSpace=k.outputColorSpace,X.batching=k.batching,X.batchingColor=k.batchingColor,X.instancing=k.instancing,X.instancingColor=k.instancingColor,X.instancingMorph=k.instancingMorph,X.skinning=k.skinning,X.morphTargets=k.morphTargets,X.morphNormals=k.morphNormals,X.morphColors=k.morphColors,X.morphTargetsCount=k.morphTargetsCount,X.numClippingPlanes=k.numClippingPlanes,X.numIntersection=k.numClipIntersection,X.vertexAlphas=k.vertexAlphas,X.vertexTangents=k.vertexTangents,X.toneMapping=k.toneMapping}function c_(R,k,X,Y,z){k.isScene!==!0&&(k=ve),fe.resetTextureUnits();let he=k.fog,ye=Y.isMeshStandardMaterial?k.environment:null,Re=A===null?v.outputColorSpace:A.isXRRenderTarget===!0?A.texture.colorSpace:qr,we=(Y.isMeshStandardMaterial?_e:Ie).get(Y.envMap||ye),ze=Y.vertexColors===!0&&!!X.attributes.color&&X.attributes.color.itemSize===4,Ge=!!X.attributes.tangent&&(!!Y.normalMap||Y.anisotropy>0),Oe=!!X.morphAttributes.position,Qe=!!X.morphAttributes.normal,ot=!!X.morphAttributes.color,Et=ki;Y.toneMapped&&(A===null||A.isXRRenderTarget===!0)&&(Et=v.toneMapping);let ht=X.morphAttributes.position||X.morphAttributes.normal||X.morphAttributes.color,at=ht!==void 0?ht.length:0,ke=J.get(Y),gt=p.state.lights;if(Ve===!0&&(q===!0||R!==T)){let Qt=R===T&&Y.id===w;ue.setState(Y,R,Qt)}let nt=!1;Y.version===ke.__version?(ke.needsLights&&ke.lightsStateVersion!==gt.state.version||ke.outputColorSpace!==Re||z.isBatchedMesh&&ke.batching===!1||!z.isBatchedMesh&&ke.batching===!0||z.isBatchedMesh&&ke.batchingColor===!0&&z.colorTexture===null||z.isBatchedMesh&&ke.batchingColor===!1&&z.colorTexture!==null||z.isInstancedMesh&&ke.instancing===!1||!z.isInstancedMesh&&ke.instancing===!0||z.isSkinnedMesh&&ke.skinning===!1||!z.isSkinnedMesh&&ke.skinning===!0||z.isInstancedMesh&&ke.instancingColor===!0&&z.instanceColor===null||z.isInstancedMesh&&ke.instancingColor===!1&&z.instanceColor!==null||z.isInstancedMesh&&ke.instancingMorph===!0&&z.morphTexture===null||z.isInstancedMesh&&ke.instancingMorph===!1&&z.morphTexture!==null||ke.envMap!==we||Y.fog===!0&&ke.fog!==he||ke.numClippingPlanes!==void 0&&(ke.numClippingPlanes!==ue.numPlanes||ke.numIntersection!==ue.numIntersection)||ke.vertexAlphas!==ze||ke.vertexTangents!==Ge||ke.morphTargets!==Oe||ke.morphNormals!==Qe||ke.morphColors!==ot||ke.toneMapping!==Et||ke.morphTargetsCount!==at)&&(nt=!0):(nt=!0,ke.__version=Y.version);let mn=ke.currentProgram;nt===!0&&(mn=rl(Y,k,z));let as=!1,gn=!1,yo=!1,vt=mn.getUniforms(),Cn=ke.uniforms;if(G.useProgram(mn.program)&&(as=!0,gn=!0,yo=!0),Y.id!==w&&(w=Y.id,gn=!0),as||T!==R){G.buffers.depth.getReversed()&&R.reversedDepth!==!0&&(R._reversedDepth=!0,R.updateProjectionMatrix()),vt.setValue(I,"projectionMatrix",R.projectionMatrix),vt.setValue(I,"viewMatrix",R.matrixWorldInverse);let on=vt.map.cameraPosition;on!==void 0&&on.setValue(I,pe.setFromMatrixPosition(R.matrixWorld)),H.logarithmicDepthBuffer&&vt.setValue(I,"logDepthBufFC",2/(Math.log(R.far+1)/Math.LN2)),(Y.isMeshPhongMaterial||Y.isMeshToonMaterial||Y.isMeshLambertMaterial||Y.isMeshBasicMaterial||Y.isMeshStandardMaterial||Y.isShaderMaterial)&&vt.setValue(I,"isOrthographic",R.isOrthographicCamera===!0),T!==R&&(T=R,gn=!0,yo=!0)}if(z.isSkinnedMesh){vt.setOptional(I,z,"bindMatrix"),vt.setOptional(I,z,"bindMatrixInverse");let Qt=z.skeleton;Qt&&(Qt.boneTexture===null&&Qt.computeBoneTexture(),vt.setValue(I,"boneTexture",Qt.boneTexture,fe))}z.isBatchedMesh&&(vt.setOptional(I,z,"batchingTexture"),vt.setValue(I,"batchingTexture",z._matricesTexture,fe),vt.setOptional(I,z,"batchingIdTexture"),vt.setValue(I,"batchingIdTexture",z._indirectTexture,fe),vt.setOptional(I,z,"batchingColorTexture"),z._colorsTexture!==null&&vt.setValue(I,"batchingColorTexture",z._colorsTexture,fe));let Rn=X.morphAttributes;if((Rn.position!==void 0||Rn.normal!==void 0||Rn.color!==void 0)&&se.update(z,X,mn),(gn||ke.receiveShadow!==z.receiveShadow)&&(ke.receiveShadow=z.receiveShadow,vt.setValue(I,"receiveShadow",z.receiveShadow)),Y.isMeshGouraudMaterial&&Y.envMap!==null&&(Cn.envMap.value=we,Cn.flipEnvMap.value=we.isCubeTexture&&we.isRenderTargetTexture===!1?-1:1),Y.isMeshStandardMaterial&&Y.envMap===null&&k.environment!==null&&(Cn.envMapIntensity.value=k.environmentIntensity),gn&&(vt.setValue(I,"toneMappingExposure",v.toneMappingExposure),ke.needsLights&&u_(Cn,yo),he&&Y.fog===!0&&Q.refreshFogUniforms(Cn,he),Q.refreshMaterialUniforms(Cn,Y,W,Z,p.state.transmissionRenderTarget[R.id]),vo.upload(I,wm(ke),Cn,fe)),Y.isShaderMaterial&&Y.uniformsNeedUpdate===!0&&(vo.upload(I,wm(ke),Cn,fe),Y.uniformsNeedUpdate=!1),Y.isSpriteMaterial&&vt.setValue(I,"center",z.center),vt.setValue(I,"modelViewMatrix",z.modelViewMatrix),vt.setValue(I,"normalMatrix",z.normalMatrix),vt.setValue(I,"modelMatrix",z.matrixWorld),Y.isShaderMaterial||Y.isRawShaderMaterial){let Qt=Y.uniformsGroups;for(let on=0,Eh=Qt.length;on<Eh;on++){let Er=Qt[on];Ye.update(Er,mn),Ye.bind(Er,mn)}}return mn}function u_(R,k){R.ambientLightColor.needsUpdate=k,R.lightProbe.needsUpdate=k,R.directionalLights.needsUpdate=k,R.directionalLightShadows.needsUpdate=k,R.pointLights.needsUpdate=k,R.pointLightShadows.needsUpdate=k,R.spotLights.needsUpdate=k,R.spotLightShadows.needsUpdate=k,R.rectAreaLights.needsUpdate=k,R.hemisphereLights.needsUpdate=k}function h_(R){return R.isMeshLambertMaterial||R.isMeshToonMaterial||R.isMeshPhongMaterial||R.isMeshStandardMaterial||R.isShadowMaterial||R.isShaderMaterial&&R.lights===!0}this.getActiveCubeFace=function(){return S},this.getActiveMipmapLevel=function(){return E},this.getRenderTarget=function(){return A},this.setRenderTargetTextures=function(R,k,X){let Y=J.get(R);Y.__autoAllocateDepthBuffer=R.resolveDepthBuffer===!1,Y.__autoAllocateDepthBuffer===!1&&(Y.__useRenderToTexture=!1),J.get(R.texture).__webglTexture=k,J.get(R.depthTexture).__webglTexture=Y.__autoAllocateDepthBuffer?void 0:X,Y.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(R,k){let X=J.get(R);X.__webglFramebuffer=k,X.__useDefaultFramebuffer=k===void 0};let f_=I.createFramebuffer();this.setRenderTarget=function(R,k=0,X=0){A=R,S=k,E=X;let Y=!0,z=null,he=!1,ye=!1;if(R){let we=J.get(R);if(we.__useDefaultFramebuffer!==void 0)G.bindFramebuffer(I.FRAMEBUFFER,null),Y=!1;else if(we.__webglFramebuffer===void 0)fe.setupRenderTarget(R);else if(we.__hasExternalTextures)fe.rebindTextures(R,J.get(R.texture).__webglTexture,J.get(R.depthTexture).__webglTexture);else if(R.depthBuffer){let Oe=R.depthTexture;if(we.__boundDepthTexture!==Oe){if(Oe!==null&&J.has(Oe)&&(R.width!==Oe.image.width||R.height!==Oe.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");fe.setupDepthRenderbuffer(R)}}let ze=R.texture;(ze.isData3DTexture||ze.isDataArrayTexture||ze.isCompressedArrayTexture)&&(ye=!0);let Ge=J.get(R).__webglFramebuffer;R.isWebGLCubeRenderTarget?(Array.isArray(Ge[k])?z=Ge[k][X]:z=Ge[k],he=!0):R.samples>0&&fe.useMultisampledRTT(R)===!1?z=J.get(R).__webglMultisampledFramebuffer:Array.isArray(Ge)?z=Ge[X]:z=Ge,b.copy(R.viewport),L.copy(R.scissor),D=R.scissorTest}else b.copy(de).multiplyScalar(W).floor(),L.copy(Ue).multiplyScalar(W).floor(),D=He;if(X!==0&&(z=f_),G.bindFramebuffer(I.FRAMEBUFFER,z)&&Y&&G.drawBuffers(R,z),G.viewport(b),G.scissor(L),G.setScissorTest(D),he){let we=J.get(R.texture);I.framebufferTexture2D(I.FRAMEBUFFER,I.COLOR_ATTACHMENT0,I.TEXTURE_CUBE_MAP_POSITIVE_X+k,we.__webglTexture,X)}else if(ye){let we=k;for(let ze=0;ze<R.textures.length;ze++){let Ge=J.get(R.textures[ze]);I.framebufferTextureLayer(I.FRAMEBUFFER,I.COLOR_ATTACHMENT0+ze,Ge.__webglTexture,X,we)}}else if(R!==null&&X!==0){let we=J.get(R.texture);I.framebufferTexture2D(I.FRAMEBUFFER,I.COLOR_ATTACHMENT0,I.TEXTURE_2D,we.__webglTexture,X)}w=-1},this.readRenderTargetPixels=function(R,k,X,Y,z,he,ye,Re=0){if(!(R&&R.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let we=J.get(R).__webglFramebuffer;if(R.isWebGLCubeRenderTarget&&ye!==void 0&&(we=we[ye]),we){G.bindFramebuffer(I.FRAMEBUFFER,we);try{let ze=R.textures[Re],Ge=ze.format,Oe=ze.type;if(!H.textureFormatReadable(Ge)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!H.textureTypeReadable(Oe)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}k>=0&&k<=R.width-Y&&X>=0&&X<=R.height-z&&(R.textures.length>1&&I.readBuffer(I.COLOR_ATTACHMENT0+Re),I.readPixels(k,X,Y,z,Pe.convert(Ge),Pe.convert(Oe),he))}finally{let ze=A!==null?J.get(A).__webglFramebuffer:null;G.bindFramebuffer(I.FRAMEBUFFER,ze)}}},this.readRenderTargetPixelsAsync=async function(R,k,X,Y,z,he,ye,Re=0){if(!(R&&R.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let we=J.get(R).__webglFramebuffer;if(R.isWebGLCubeRenderTarget&&ye!==void 0&&(we=we[ye]),we)if(k>=0&&k<=R.width-Y&&X>=0&&X<=R.height-z){G.bindFramebuffer(I.FRAMEBUFFER,we);let ze=R.textures[Re],Ge=ze.format,Oe=ze.type;if(!H.textureFormatReadable(Ge))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!H.textureTypeReadable(Oe))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let Qe=I.createBuffer();I.bindBuffer(I.PIXEL_PACK_BUFFER,Qe),I.bufferData(I.PIXEL_PACK_BUFFER,he.byteLength,I.STREAM_READ),R.textures.length>1&&I.readBuffer(I.COLOR_ATTACHMENT0+Re),I.readPixels(k,X,Y,z,Pe.convert(Ge),Pe.convert(Oe),0);let ot=A!==null?J.get(A).__webglFramebuffer:null;G.bindFramebuffer(I.FRAMEBUFFER,ot);let Et=I.fenceSync(I.SYNC_GPU_COMMANDS_COMPLETE,0);return I.flush(),await _y(I,Et,4),I.bindBuffer(I.PIXEL_PACK_BUFFER,Qe),I.getBufferSubData(I.PIXEL_PACK_BUFFER,0,he),I.deleteBuffer(Qe),I.deleteSync(Et),he}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(R,k=null,X=0){let Y=Math.pow(2,-X),z=Math.floor(R.image.width*Y),he=Math.floor(R.image.height*Y),ye=k!==null?k.x:0,Re=k!==null?k.y:0;fe.setTexture2D(R,0),I.copyTexSubImage2D(I.TEXTURE_2D,X,0,0,ye,Re,z,he),G.unbindTexture()};let d_=I.createFramebuffer(),p_=I.createFramebuffer();this.copyTextureToTexture=function(R,k,X=null,Y=null,z=0,he=null){he===null&&(z!==0?(js("WebGLRenderer: copyTextureToTexture function signature has changed to support src and dst mipmap levels."),he=z,z=0):he=0);let ye,Re,we,ze,Ge,Oe,Qe,ot,Et,ht=R.isCompressedTexture?R.mipmaps[he]:R.image;if(X!==null)ye=X.max.x-X.min.x,Re=X.max.y-X.min.y,we=X.isBox3?X.max.z-X.min.z:1,ze=X.min.x,Ge=X.min.y,Oe=X.isBox3?X.min.z:0;else{let Rn=Math.pow(2,-z);ye=Math.floor(ht.width*Rn),Re=Math.floor(ht.height*Rn),R.isDataArrayTexture?we=ht.depth:R.isData3DTexture?we=Math.floor(ht.depth*Rn):we=1,ze=0,Ge=0,Oe=0}Y!==null?(Qe=Y.x,ot=Y.y,Et=Y.z):(Qe=0,ot=0,Et=0);let at=Pe.convert(k.format),ke=Pe.convert(k.type),gt;k.isData3DTexture?(fe.setTexture3D(k,0),gt=I.TEXTURE_3D):k.isDataArrayTexture||k.isCompressedArrayTexture?(fe.setTexture2DArray(k,0),gt=I.TEXTURE_2D_ARRAY):(fe.setTexture2D(k,0),gt=I.TEXTURE_2D),I.pixelStorei(I.UNPACK_FLIP_Y_WEBGL,k.flipY),I.pixelStorei(I.UNPACK_PREMULTIPLY_ALPHA_WEBGL,k.premultiplyAlpha),I.pixelStorei(I.UNPACK_ALIGNMENT,k.unpackAlignment);let nt=I.getParameter(I.UNPACK_ROW_LENGTH),mn=I.getParameter(I.UNPACK_IMAGE_HEIGHT),as=I.getParameter(I.UNPACK_SKIP_PIXELS),gn=I.getParameter(I.UNPACK_SKIP_ROWS),yo=I.getParameter(I.UNPACK_SKIP_IMAGES);I.pixelStorei(I.UNPACK_ROW_LENGTH,ht.width),I.pixelStorei(I.UNPACK_IMAGE_HEIGHT,ht.height),I.pixelStorei(I.UNPACK_SKIP_PIXELS,ze),I.pixelStorei(I.UNPACK_SKIP_ROWS,Ge),I.pixelStorei(I.UNPACK_SKIP_IMAGES,Oe);let vt=R.isDataArrayTexture||R.isData3DTexture,Cn=k.isDataArrayTexture||k.isData3DTexture;if(R.isDepthTexture){let Rn=J.get(R),Qt=J.get(k),on=J.get(Rn.__renderTarget),Eh=J.get(Qt.__renderTarget);G.bindFramebuffer(I.READ_FRAMEBUFFER,on.__webglFramebuffer),G.bindFramebuffer(I.DRAW_FRAMEBUFFER,Eh.__webglFramebuffer);for(let Er=0;Er<we;Er++)vt&&(I.framebufferTextureLayer(I.READ_FRAMEBUFFER,I.COLOR_ATTACHMENT0,J.get(R).__webglTexture,z,Oe+Er),I.framebufferTextureLayer(I.DRAW_FRAMEBUFFER,I.COLOR_ATTACHMENT0,J.get(k).__webglTexture,he,Et+Er)),I.blitFramebuffer(ze,Ge,ye,Re,Qe,ot,ye,Re,I.DEPTH_BUFFER_BIT,I.NEAREST);G.bindFramebuffer(I.READ_FRAMEBUFFER,null),G.bindFramebuffer(I.DRAW_FRAMEBUFFER,null)}else if(z!==0||R.isRenderTargetTexture||J.has(R)){let Rn=J.get(R),Qt=J.get(k);G.bindFramebuffer(I.READ_FRAMEBUFFER,d_),G.bindFramebuffer(I.DRAW_FRAMEBUFFER,p_);for(let on=0;on<we;on++)vt?I.framebufferTextureLayer(I.READ_FRAMEBUFFER,I.COLOR_ATTACHMENT0,Rn.__webglTexture,z,Oe+on):I.framebufferTexture2D(I.READ_FRAMEBUFFER,I.COLOR_ATTACHMENT0,I.TEXTURE_2D,Rn.__webglTexture,z),Cn?I.framebufferTextureLayer(I.DRAW_FRAMEBUFFER,I.COLOR_ATTACHMENT0,Qt.__webglTexture,he,Et+on):I.framebufferTexture2D(I.DRAW_FRAMEBUFFER,I.COLOR_ATTACHMENT0,I.TEXTURE_2D,Qt.__webglTexture,he),z!==0?I.blitFramebuffer(ze,Ge,ye,Re,Qe,ot,ye,Re,I.COLOR_BUFFER_BIT,I.NEAREST):Cn?I.copyTexSubImage3D(gt,he,Qe,ot,Et+on,ze,Ge,ye,Re):I.copyTexSubImage2D(gt,he,Qe,ot,ze,Ge,ye,Re);G.bindFramebuffer(I.READ_FRAMEBUFFER,null),G.bindFramebuffer(I.DRAW_FRAMEBUFFER,null)}else Cn?R.isDataTexture||R.isData3DTexture?I.texSubImage3D(gt,he,Qe,ot,Et,ye,Re,we,at,ke,ht.data):k.isCompressedArrayTexture?I.compressedTexSubImage3D(gt,he,Qe,ot,Et,ye,Re,we,at,ht.data):I.texSubImage3D(gt,he,Qe,ot,Et,ye,Re,we,at,ke,ht):R.isDataTexture?I.texSubImage2D(I.TEXTURE_2D,he,Qe,ot,ye,Re,at,ke,ht.data):R.isCompressedTexture?I.compressedTexSubImage2D(I.TEXTURE_2D,he,Qe,ot,ht.width,ht.height,at,ht.data):I.texSubImage2D(I.TEXTURE_2D,he,Qe,ot,ye,Re,at,ke,ht);I.pixelStorei(I.UNPACK_ROW_LENGTH,nt),I.pixelStorei(I.UNPACK_IMAGE_HEIGHT,mn),I.pixelStorei(I.UNPACK_SKIP_PIXELS,as),I.pixelStorei(I.UNPACK_SKIP_ROWS,gn),I.pixelStorei(I.UNPACK_SKIP_IMAGES,yo),he===0&&k.generateMipmaps&&I.generateMipmap(gt),G.unbindTexture()},this.initRenderTarget=function(R){J.get(R).__webglFramebuffer===void 0&&fe.setupRenderTarget(R)},this.initTexture=function(R){R.isCubeTexture?fe.setTextureCube(R,0):R.isData3DTexture?fe.setTexture3D(R,0):R.isDataArrayTexture||R.isCompressedArrayTexture?fe.setTexture2DArray(R,0):fe.setTexture2D(R,0),G.unbindTexture()},this.resetState=function(){S=0,E=0,A=null,G.reset(),me.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Qn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=tt._getDrawingBufferColorSpace(e),t.unpackColorSpace=tt._getUnpackColorSpace()}};function n_(n,e=1e-4){e=Math.max(e,Number.EPSILON);let t={},i=n.getIndex(),r=n.getAttribute("position"),s=i?i.count:r.count,o=0,a=Object.keys(n.attributes),l={},u={},h=[],c=["getX","getY","getZ","getW"],f=["setX","setY","setZ","setW"];for(let _=0,g=a.length;_<g;_++){let v=a[_],M=n.attributes[v];l[v]=new M.constructor(new M.array.constructor(M.count*M.itemSize),M.itemSize,M.normalized);let S=n.morphAttributes[v];S&&(u[v]||(u[v]=[]),S.forEach((E,A)=>{let w=new E.array.constructor(E.count*E.itemSize);u[v][A]=new E.constructor(w,E.itemSize,E.normalized)}))}let d=e*.5,m=Math.log10(1/e),x=Math.pow(10,m),y=d*x;for(let _=0;_<s;_++){let g=i?i.getX(_):_,v="";for(let M=0,S=a.length;M<S;M++){let E=a[M],A=n.getAttribute(E),w=A.itemSize;for(let T=0;T<w;T++)v+=`${~~(A[c[T]](g)*x+y)},`}if(v in t)h.push(t[v]);else{for(let M=0,S=a.length;M<S;M++){let E=a[M],A=n.getAttribute(E),w=n.morphAttributes[E],T=A.itemSize,b=l[E],L=u[E];for(let D=0;D<T;D++){let F=c[D],U=f[D];if(b[U](o,A[F](g)),w)for(let O=0,Z=w.length;O<Z;O++)L[O][U](o,w[O][F](g))}}t[v]=o,h.push(o),o++}}let p=n.clone();for(let _ in n.attributes){let g=l[_];if(p.setAttribute(_,new g.constructor(g.array.slice(0,o*g.itemSize),g.itemSize,g.normalized)),_ in u)for(let v=0;v<u[_].length;v++){let M=u[_][v];p.morphAttributes[_][v]=new M.constructor(M.array.slice(0,o*M.itemSize),M.itemSize,M.normalized)}}return p.setIndex(h),p}var i_=(()=>{let n=window.parent!==window&&new URLSearchParams(location.search).get("feedReview")==="1",e=!n,t=new Set,i=()=>{document.documentElement.dataset.feedPreview=String(!e);for(let r of t)r(e&&!document.hidden)};return window.addEventListener("message",r=>{!n||r.source!==parent||r.origin!==location.origin||r.data?.type!=="playable-active"||(e=r.data.active===!0,i())}),document.addEventListener("visibilitychange",i),i(),{get active(){return e&&!document.hidden},subscribe(r){return t.add(r),()=>t.delete(r)}}})(),iP=window.matchMedia("(prefers-reduced-motion: reduce)");function vb(){let[n,e]=Ne.default.useState(i_.active);return Ne.default.useEffect(()=>i_.subscribe(e),[]),n}var xb=`
button { touch-action: manipulation; }
button:focus-visible { outline: 3px solid #3c8ddd; outline-offset: 3px; }
@keyframes batchBreathe { 0%,100% { opacity:.72; } 50% { opacity:1; } }
.preview-example { position:fixed; z-index:2; pointer-events:none; width:min(80%,340px); left:50%; top:35%; transform:translateX(-50%); }
.preview-example svg { width:100%; height:auto; overflow:visible; }
.example-blob { transform-origin:50% 60%; animation:exampleSquish 3.8s ease-in-out infinite; }
.example-noodle { transform-origin:50% 70%; animation:exampleWiggle 3.6s ease-in-out infinite; }
.example-poem { padding:20px; color:#44444c; font:15px/1.8 ui-monospace,monospace; clip-path:ellipse(49% 47% at 50% 50%); animation:exampleInk 5s ease-in-out infinite; }
.example-poem em { color:#ad7397; font-style:normal; }
@keyframes exampleSquish { 0%,100% {transform:scale(1,1) rotate(-3deg)} 40% {transform:scale(1.06,.94) rotate(2deg)} 70% {transform:scale(.96,1.04) rotate(-1deg)} }
@keyframes exampleWiggle { 0%,100% { transform:rotate(-3deg) translateY(0); } 50% { transform:rotate(3deg) translateY(-5px); } }
@keyframes exampleInk { 0%,100% {opacity:.25;clip-path:ellipse(23% 35% at 32% 50%)} 45%,70% {opacity:.9;clip-path:ellipse(49% 47% at 50% 50%)} }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; } }
`;var r_={TRACE_CLOSE_GAP:28,TRACE_MIN_LENGTH:90,SOFT_BODY_COLUMNS:9,SOFT_BODY_ROWS:9,GRAVITY:.7,BODY_WIDTH_RATIO:.74,GUIDE_TEXT:"Trace around the cat",RESET_LABEL:"Reset",CONFIRM_LABEL:"Make squishy",RESET_SHAPE_LABEL:"Reset shape",CHOOSE_LABEL:"Choose image",PICKER_TITLE:"Choose an image",BACK_LABEL:"Back",HAMSTER_HONEY:"./assets/cat-phone-rug.webp",HAMSTER_CARAMEL:"./assets/cat-phone-sofa.webp",HAMSTER_SILVER:"./assets/cat-phone-window.webp"},Ft=(n,e,t)=>Math.max(e,Math.min(t,n)),yb=(n,e)=>Math.hypot(n.x-e.x,n.y-e.y),Mh=n=>Math.abs(n.reduce((e,t,i)=>{let r=n[(i+1)%n.length];return e+t.u*r.v-r.u*t.v},0))/2;function xm(n,e,t){let i=Math.min(n*.98/t.width,e*.98/t.height),r=t.width*i,s=t.height*i;return{x:(n-r)/2,y:(e-s)/2,width:r,height:s}}function Sh(n){let e=n.filter((t,i)=>!i||Math.hypot(t.u-n[i-1].u,t.v-n[i-1].v)>.0015).map(t=>({...t}));return e.length>2&&Math.hypot(e[0].u-e.at(-1).u,e[0].v-e.at(-1).v)<.003&&e.pop(),e.length>180?Array.from({length:180},(t,i)=>e[Math.floor(i*e.length/180)]):e}function _b(n,e,t,i){let r=e.u-n.u,s=e.v-n.v,o=i.u-t.u,a=i.v-t.v,l=t.u-n.u,u=t.v-n.v,h=r*a-s*o,c=1e-10;if(Math.abs(h)<c){if(Math.abs(l*s-u*r)>c)return null;let m=r*r+s*s;if(m<c)return null;let x=(l*r+u*s)/m,y=((i.u-n.u)*r+(i.v-n.v)*s)/m,p=Math.max(0,Math.min(x,y)),_=Math.min(1,Math.max(x,y));return p>_+c?null:{u:n.u+r*p,v:n.v+s*p}}let f=(l*a-u*o)/h,d=(l*s-u*r)/h;return f<-c||f>1+c||d<-c||d>1+c?null:{u:n.u+r*Ft(f,0,1),v:n.v+s*Ft(f,0,1)}}function a_(n){for(let e=0;e<n.length;e++)for(let t=e+2;t<n.length;t++){if(e===0&&t===n.length-1)continue;let i=_b(n[e],n[(e+1)%n.length],n[t],n[(t+1)%n.length]);if(i)return{i:e,j:t,point:i}}return null}function l_(n){return!!a_(n)}function Sb(n){let e=Sh(n);for(let t=0;t<180&&e.length>2;t++){let i=a_(e);if(!i)break;let{i:r,j:s,point:o}=i,a=Sh([o,...e.slice(r+1,s+1)]),l=Sh([o,...e.slice(s+1),...e.slice(0,r+1)]),u=Mh(a)>=Mh(l)?a:l;if(u.length>=e.length)return[];e=u}return l_(e)?[]:e}function Mb(n,e){let t=Math.max(0,Math.floor(Math.min(...e.map(v=>v.u))*n.width)),i=Math.max(0,Math.floor(Math.min(...e.map(v=>v.v))*n.height)),r=Math.min(n.width,Math.ceil(Math.max(...e.map(v=>v.u))*n.width)),s=Math.min(n.height,Math.ceil(Math.max(...e.map(v=>v.v))*n.height)),o=r-t,a=s-i,l=Math.min(1,1024/Math.max(o,a));if(o<8||a<8)throw Error("Trace a larger area of the photo.");let u=document.createElement("canvas");u.width=Math.max(1,Math.round(o*l)),u.height=Math.max(1,Math.round(a*l));let h=u.getContext("2d");h.save(),h.scale(l,l),h.translate(-t,-i),h.beginPath(),e.forEach((v,M)=>M?h.lineTo(v.u*n.width,v.v*n.height):h.moveTo(v.u*n.width,v.v*n.height)),h.closePath(),h.clip(),h.drawImage(n,0,0),h.restore();let c=h.getImageData(0,0,u.width,u.height).data,f=0,d=0,m=0,x=0;for(let v=0;v<c.length;v+=4)c[v+3]>100&&(f++,d+=c[v],m+=c[v+1],x+=c[v+2]);if(f<100)throw Error("Keep the outline inside your photo.");let y=3/Math.max(o,a),p=e.map(v=>new Se((v.u*n.width-t-o/2)*y,(a/2-(v.v*n.height-i))*y)),_=document.createElement("canvas");_.width=u.width,_.height=u.height;let g=_.getContext("2d");return g.fillStyle=`rgb(${Math.round(d/f)},${Math.round(m/f)},${Math.round(x/f)})`,g.fillRect(0,0,_.width,_.height),g.drawImage(n,t,i,o,a,0,0,_.width,_.height),{texture:u,wrapTexture:_,contour:p,width:o*y,height:a*y,opaque:f,sourceWidth:n.width,sourceHeight:n.height}}function wb(n,e,t){let i=1/0;for(let r=0;r<t.length;r++){let s=t[r],o=t[(r+1)%t.length],a=o.x-s.x,l=o.y-s.y,u=Ft(((n-s.x)*a+(e-s.y)*l)/(a*a+l*l||1),0,1);i=Math.min(i,Math.hypot(n-s.x-u*a,e-s.y-u*l))}return i}function Eb(n){let e=n.map(a=>a.clone());for(let a=0;a<3;a++){let l=[];e.forEach((u,h)=>{let c=e[(h+1)%e.length];l.push(u.clone().lerp(c,.2),u.clone().lerp(c,.8))}),e=l}let t=e.map((a,l)=>a.distanceTo(e[(l+1)%e.length])),i=t.reduce((a,l)=>a+l,0),r=[],s=0,o=0;for(let a=0;a<128;a++){let l=a/128*i;for(;s<e.length-1&&o+t[s]<l;)o+=t[s],s++;r.push(e[s].clone().lerp(e[(s+1)%e.length],(l-o)/(t[s]||1)))}return r.filter((a,l)=>{let u=r[(l+r.length-1)%r.length],h=r[(l+1)%r.length];return Math.abs((a.x-u.x)*(h.y-a.y)-(a.y-u.y)*(h.x-a.x))>1e-8})}function s_(n){let e=new Ga(n),t=e.toNonIndexed(),i=t.getAttribute("position"),r=[],s=(o,a,l,u)=>{if(u){let h=o.clone().add(a).multiplyScalar(.5),c=a.clone().add(l).multiplyScalar(.5),f=l.clone().add(o).multiplyScalar(.5);s(o,h,f,u-1),s(h,a,c,u-1),s(f,c,l,u-1),s(h,c,f,u-1)}else r.push(o,a,l)};for(let o=0;o<i.count;o+=3){let a=new Se(i.getX(o),i.getY(o)),l=new Se(i.getX(o+1),i.getY(o+1)),u=new Se(i.getX(o+2),i.getY(o+2)),h=a.clone().add(l).multiplyScalar(.5),c=l.clone().add(u).multiplyScalar(.5),f=u.clone().add(a).multiplyScalar(.5),d=a.clone().add(l).add(u).multiplyScalar(1/3);s(a,h,d,2),s(h,l,d,2),s(l,c,d,2),s(c,u,d,2),s(u,f,d,2),s(f,a,d,2)}return e.dispose(),t.dispose(),r}function Tb(n){let e=Eb(n.contour).map(x=>new Se(Math.fround(x.x),Math.fround(x.y))),t=s_(new Zr(e)),i=t.map(x=>wb(x.x,x.y,e)),r=Math.max(...i,.001),s=Math.min(n.width,n.height)*.37,o=[],a=[],l=(x,y)=>{let p=t[x],_=i[x]<1e-10?0:Ft(i[x]/r,0,1),g=y*s*Math.sqrt(_*(2-_));o.push(p.x,p.y,g),a.push(Ft(p.x/n.width+.5,0,1),Ft(p.y/n.height+.5,0,1))};for(let x=0;x<t.length;x+=3)l(x,1),l(x+1,1),l(x+2,1),l(x+2,-1),l(x+1,-1),l(x,-1);let u=new ti;u.setAttribute("position",new $t(o,3)),u.setAttribute("uv",new $t(a,2));let h=n_(u,3e-5);u.dispose(),h.computeVertexNormals(),h.addGroup(0,h.index.count,0);let c=n.width/2+.1,f=n.height/2+.1,d=new Zr([new Se(-c,-f),new Se(c,-f),new Se(c,f),new Se(-c,f)]);d.holes.push(new $r(e));let m=t.concat(s_(d));return h.userData.safetyPlane=new Float32Array(m.flatMap(x=>[x.x,x.y])),h}function Ab(n,e,t=145){let i=Math.hypot(n,e);if(i<1e-8)return{x:0,y:0};let r=t*Math.tanh(i/t)/i;return{x:n*r,y:e*r}}function bb(n,e){let t=1-Math.exp(-e/12);n.offset.x+=(n.target.x-n.offset.x)*t,n.offset.y+=(n.target.y-n.offset.y)*t,n.joints.forEach((i,r)=>{i.pointA.x=n.starts[r].x+n.offset.x,i.pointA.y=n.starts[r].y+n.offset.y})}function Cb(n,e){let t=8.333333333333334;for(let i of e.values())bb(i,t);n.bodies.forEach((i,r)=>{let s=n.rest[r],o=s.x-i.position.x,a=s.y-i.position.y,l=Math.hypot(o,a),u=35e-6*(1+Math.max(0,l-160)**2/1e4);Kt.default.Body.applyForce(i,i.position,{x:o*i.mass*u,y:a*i.mass*u})}),Kt.default.Engine.update(n.engine,t)}function Rb(n,e){let t=Ft(Math.round(e.SOFT_BODY_COLUMNS),7,17),i=Ft(Math.round(e.SOFT_BODY_ROWS),7,17),r=90,s=(n.width+.2)*r,o=(n.height+.2)*r,a=-s/2,l=-o/2,u=Kt.default.Engine.create({positionIterations:6,constraintIterations:4});u.gravity.y=e.GRAVITY,u.gravity.scale=1e-5;let h=[],c=[];for(let d=0;d<i;d++)for(let m=0;m<t;m++)h.push(Kt.default.Bodies.circle(a+m*s/(t-1),l+d*o/(i-1),2,{frictionAir:.075,collisionFilter:{group:-1},inertia:1/0}));let f=(d,m,x)=>c.push(Kt.default.Constraint.create({bodyA:h[d],bodyB:h[m],stiffness:x,damping:.12}));for(let d=0;d<i;d++)for(let m=0;m<t;m++){let x=d*t+m;m<t-1&&f(x,x+1,.32),d<i-1&&f(x,x+t,.32),m<t-1&&d<i-1&&(f(x,x+t+1,.16),f(x+1,x+t,.16))}return Kt.default.Composite.add(u.world,[...h,...c]),{engine:u,bodies:h,rest:h.map(d=>({...d.position})),columns:t,rows:i,width:s,height:o,left:a,top:l,unit:r}}function Pb(n,e){let t=n.attributes.position,i=new Float32Array(t.array),r=[],s=new Map,o=[],a=(p,_)=>{p=Math.fround(p),_=Math.fround(_);let g=p+":"+_;if(s.has(g))return s.get(g);let v=r.length/2;return r.push(p,_),s.set(g,v),v},l=n.userData.safetyPlane;for(let p=0;p<l.length;p+=6){let _=a(l[p],l[p+1]),g=a(l[p+2],l[p+3]),v=a(l[p+4],l[p+5]),M=r[_*2],S=r[_*2+1],E=r[g*2]-M,A=r[g*2+1]-S,w=r[v*2]-M,T=r[v*2+1]-S,b=E*T-A*w;Math.abs(b)>1e-14&&o.push(_,g,v,T/b,-w/b,-A/b,E/b)}let u=Array.from({length:t.count},(p,_)=>a(i[_*3],i[_*3+1])),h=r.filter((p,_)=>_%2===0).map((p,_)=>{let g=r[_*2+1],v=Ft((p*e.unit-e.left)/e.width*(e.columns-1),0,e.columns-1-1e-5),M=Ft((-g*e.unit-e.top)/e.height*(e.rows-1),0,e.rows-1-1e-5),S=Math.floor(v),E=Math.floor(M),A=v-S,w=M-E;return{ids:[E*e.columns+S,E*e.columns+S+1,(E+1)*e.columns+S,(E+1)*e.columns+S+1],weights:[(1-A)*(1-w),A*(1-w),(1-A)*w,A*w]}}),c=new Float64Array(r.length),f=new Float64Array(r.length),d=e.rest.reduce((p,_)=>p+_.x*_.x,0),m=e.rest.reduce((p,_)=>p+_.y*_.y,0),x=e.bodies.map(p=>({...p.position}));return{rest:i,reset:()=>e.bodies.forEach((p,_)=>{x[_].x=p.position.x,x[_].y=p.position.y}),apply(p=1/0){let _=Number.isFinite(p)?1-Math.exp(-Math.max(0,p)/18):1;e.bodies.forEach((Fe,I)=>{x[I].x+=(Fe.position.x-x[I].x)*_,x[I].y+=(Fe.position.y-x[I].y)*_});let g=0,v=0;for(let Fe of x)g+=Fe.x,v+=Fe.y;g/=e.bodies.length,v/=e.bodies.length;let M=0,S=0,E=0,A=0;x.forEach((Fe,I)=>{let qe=e.rest[I];M+=(Fe.x-g)*qe.x/d,S+=(Fe.x-g)*qe.y/m,E+=(Fe.y-v)*qe.x/d,A+=(Fe.y-v)*qe.y/m});let w=Ft(Math.atan2(E-S,M+A),-.28,.28),T=Math.cos(w),b=Math.sin(w),L=T*M+b*E,D=-b*S+T*A,F=(T*S+b*A-b*M+T*E)/2,U=.5*Math.atan2(2*F,L-D),O=Math.cos(U),Z=Math.sin(U),W=Math.hypot(L-D,2*F),ne=Ft((L+D+W)/2,.68,1.35),re=Ft((L+D-W)/2,.68,1.35),de=O*O*ne+Z*Z*re,Ue=Z*Z*ne+O*O*re,He=O*Z*(ne-re);M=T*de-b*He,S=T*He-b*Ue,E=b*de+T*He,A=b*He+T*Ue;let Ee=Math.min(e.width,e.height)*.16,Ve=Math.hypot(g,v);Ve>Ee&&(g*=Ee/Ve,v*=Ee/Ve),h.forEach((Fe,I)=>{let qe=0,De=0;Fe.ids.forEach((fe,Ie)=>{qe+=x[fe].x*Fe.weights[Ie],De+=x[fe].y*Fe.weights[Ie]});let H=r[I*2]*e.unit,G=-r[I*2+1]*e.unit,te=(M*H+S*G+g)/e.unit,J=-(E*H+A*G+v)/e.unit;f[I*2]=te,f[I*2+1]=J,c[I*2]=qe/e.unit-te,c[I*2+1]=-De/e.unit-J});let q=0;for(let Fe=0;Fe<o.length;Fe+=7){let I=o[Fe]*2,qe=o[Fe+1]*2,De=o[Fe+2]*2,H=c[qe]-c[I],G=c[De]-c[I],te=c[qe+1]-c[I+1],J=c[De+1]-c[I+1];q=Math.max(q,Math.hypot(H*o[Fe+3]+G*o[Fe+5],H*o[Fe+4]+G*o[Fe+6],te*o[Fe+3]+J*o[Fe+5],te*o[Fe+4]+J*o[Fe+6]))}let ee=Math.min(ne,re),pe=.48*ee,Te=Math.min(1,pe/Math.max(q,1e-12)),ve=Ft(1/(ne*re),.85,1.45),Xe=0;return u.forEach((Fe,I)=>{let qe=f[Fe*2]+c[Fe*2]*Te,De=f[Fe*2+1]+c[Fe*2+1]*Te;Xe=Math.max(Xe,Math.hypot(qe-i[I*3],De-i[I*3+1])),t.setXYZ(I,qe,De,i[I*3+2]*ve)}),t.needsUpdate=!0,{maximum:Xe,blend:Te,gradientBound:q*Te,minStretch:ee,depthScale:ve}}}}function Ib(){let n=vb(),[e,t]=(0,Ne.useState)(r_),[i,r]=(0,Ne.useState)("trace"),[s,o]=(0,Ne.useState)(0),[a,l]=(0,Ne.useState)(!1),[u,h]=(0,Ne.useState)(!0),[c,f]=(0,Ne.useState)(!1),[d,m]=(0,Ne.useState)(""),[x,y]=(0,Ne.useState)(!1),[p,_]=(0,Ne.useState)(null),g=(0,Ne.useRef)(null),v=(0,Ne.useRef)(null),M=(0,Ne.useRef)(null),S=(0,Ne.useRef)(null),E=(0,Ne.useRef)([]),A=(0,Ne.useRef)(!1),w=(0,Ne.useRef)(null),T=(0,Ne.useRef)(null),b=(0,Ne.useRef)(0),L=(0,Ne.useRef)(n),D=(0,Ne.useRef)(null),F=(0,Ne.useRef)(new Map);L.current=n,(0,Ne.useEffect)(()=>{fetch("./game.config.json").then(H=>H.json()).then(H=>t({...r_,...Object.fromEntries([...H.tweaks,...H.texts].map(G=>[G.id,G.value])),...Object.fromEntries(H.images.map(G=>[G.id,G.path]))})).catch(()=>{})},[]);let U=H=>{if(L.current)try{D.current||(D.current=new(window.AudioContext||window.webkitAudioContext));let G=D.current;G.resume().catch(()=>{});let te=H==="squish"?"./assets/sfx_squish.mp3":"./assets/sfx_click_soft.mp3",J=F.current.get(te);J||(J=fetch(te).then(fe=>fe.arrayBuffer()).then(fe=>G.decodeAudioData(fe)).catch(()=>null),F.current.set(te,J)),J.then(fe=>{if(!fe||!L.current||G.state!=="running")return;let Ie=G.createBufferSource(),_e=G.createGain();_e.gain.value=H==="squish"?.23:.3,Ie.buffer=fe,Ie.connect(_e),_e.connect(G.destination),Ie.start(),Ie.onended=()=>{Ie.disconnect(),_e.disconnect()}})}catch{}},O=()=>{E.current=[],A.current=!1,w.current=null,l(!1),h(!0),m("")},Z=(0,Ne.useCallback)(async(H,G)=>{let te=++b.current;y(!0),m("");try{let J=new Image;if(J.src=H,await J.decode(),te!==b.current)return;let fe=Math.min(1,1600/Math.max(J.naturalWidth,J.naturalHeight)),Ie=document.createElement("canvas");Ie.width=Math.max(1,Math.round(J.naturalWidth*fe)),Ie.height=Math.max(1,Math.round(J.naturalHeight*fe)),Ie.getContext("2d").drawImage(J,0,0,Ie.width,Ie.height),v.current=Ie,E.current=[],A.current=!1,w.current=null,l(!1),h(!0),f(G),_(null),r("trace"),o(_e=>_e+1)}catch{te===b.current&&m("Try a JPG, PNG or WebP photo.")}finally{te===b.current&&y(!1)}},[]);(0,Ne.useEffect)(()=>{v.current||Z(e.HAMSTER_HONEY,!1)},[e.HAMSTER_HONEY,Z]),(0,Ne.useEffect)(()=>()=>{b.current++;try{D.current?.close()}catch{}},[]);let W=()=>{x||(U("tap"),g.current.value="",g.current.click())},ne=async H=>{let G=H.target.files?.[0];if(!G)return;if(!G.type.startsWith("image/")){m("Choose an image file.");return}if(G.size>25*1024*1024){m("Choose a photo smaller than 25 MB.");return}let te=URL.createObjectURL(G);try{await Z(te,!0)}finally{URL.revokeObjectURL(te)}},re=(0,Ne.useCallback)(()=>{let H=M.current,G=v.current;if(!H||!G)return;let te=H.getBoundingClientRect(),J=Math.min(devicePixelRatio||1,2),fe=te.width,Ie=te.height;H.width=Math.max(1,Math.round(fe*J)),H.height=Math.max(1,Math.round(Ie*J));let _e=H.getContext("2d");_e.setTransform(J,0,0,J,0,0),_e.clearRect(0,0,fe,Ie);let P=xm(fe,Ie,G);_e.drawImage(G,P.x,P.y,P.width,P.height);let C=E.current;if(H.dataset.traceClosed=String(A.current),H.dataset.tracePoints=String(C.length),H.dataset.traceArea=Mh(C).toFixed(5),H.dataset.traceCrossings=String(l_(C)),!C.length)return;let B=C.map(K=>({x:P.x+K.u*P.width,y:P.y+K.v*P.height}));_e.save(),_e.lineCap="round",_e.lineJoin="round",_e.lineWidth=3,_e.strokeStyle=A.current?"#d5f8ba":"#f3d292",_e.shadowColor="#0009",_e.shadowBlur=5,_e.beginPath(),B.forEach((K,Q)=>Q?_e.lineTo(K.x,K.y):_e.moveTo(K.x,K.y)),A.current&&_e.closePath(),_e.stroke(),B.length>2&&(_e.closePath(),_e.fillStyle="#f3d29222",_e.fill()),_e.shadowBlur=0,_e.fillStyle=A.current?"#d5f8ba":"#f3d292",_e.beginPath(),_e.arc(B[0].x,B[0].y,5,0,Math.PI*2),_e.fill(),_e.restore()},[s]);(0,Ne.useEffect)(()=>{if(i!=="trace"||!M.current)return;let H=new ResizeObserver(re);return H.observe(M.current),re(),()=>H.disconnect()},[i,re]);let de=H=>{let G=M.current,te=v.current;if(!G||!te)return null;let J=G.getBoundingClientRect(),fe=xm(J.width,J.height,te),Ie=H.clientX-J.left,_e=H.clientY-J.top;return{u:Ft((Ie-fe.x)/fe.width,0,1),v:Ft((_e-fe.y)/fe.height,0,1),inside:Ie>=fe.x&&Ie<=fe.x+fe.width&&_e>=fe.y&&_e<=fe.y+fe.height,fit:fe}},Ue=(H=E.current)=>{let G=Sh(H);if(G.length<3||Mh(G)<.004)return!1;let te=M.current?.getBoundingClientRect(),J=v.current;if(!te||!J)return!1;let fe=xm(te.width,te.height,J);return G.slice(1).reduce((_e,P,C)=>_e+Math.hypot((P.u-G[C].u)*fe.width,(P.v-G[C].v)*fe.height),0)>=e.TRACE_MIN_LENGTH},He=()=>{let H=Sb(E.current);return Ue(H)?(E.current=H,A.current=!0,l(!0),m(""),re(),!0):!1},Ee=H=>{if(!L.current||x||H.isPrimary===!1||H.pointerType==="mouse"&&H.button!==0)return;let G=de(H);if(G?.inside){if(A.current&&(E.current=[],A.current=!1),E.current.length>2&&Math.hypot((G.u-E.current[0].u)*G.fit.width,(G.v-E.current[0].v)*G.fit.height)<=e.TRACE_CLOSE_GAP&&Ue()){He(),h(!1);return}E.current.push({u:G.u,v:G.v}),w.current={id:H.pointerId,start:{x:H.clientX,y:H.clientY},moved:!1},h(!1),m(""),H.currentTarget.setPointerCapture(H.pointerId),re(),l(Ue())}},Ve=H=>{let G=w.current;if(!G||G.id!==H.pointerId)return;let te=de(H);if(!te)return;let J=E.current.at(-1);Math.hypot((J.u-te.u)*te.fit.width,(J.v-te.v)*te.fit.height)<2||(G.moved=!0,E.current.push({u:te.u,v:te.v}),re(),l(Ue()))},q=H=>{let G=w.current;if(!(!G||G.id!==H.pointerId)){if(w.current=null,H.type==="pointerup"&&G.moved){let te=de(H),J=E.current.at(-1);te&&J&&Math.hypot((te.u-J.u)*te.fit.width,(te.v-J.v)*te.fit.height)>=2&&E.current.push({u:te.u,v:te.v}),He()}try{H.currentTarget.hasPointerCapture(H.pointerId)&&H.currentTarget.releasePointerCapture(H.pointerId)}catch{}l(Ue()),re()}},ee=()=>{if(!He())return;let H=E.current;try{let G=Mb(v.current,H);_(G),m(""),h(!0),r("active"),U("tap")}catch(G){m(G.message||"Try tracing the shape again.")}};(0,Ne.useEffect)(()=>{if(i!=="active"||!p||!S.current)return;let H=S.current,G;try{G=new yh({canvas:H,alpha:!0,antialias:!0,powerPreference:"high-performance"})}catch{m("This browser could not open the 3D view.");return}G.setPixelRatio(Math.min(devicePixelRatio||1,2)),G.outputColorSpace=qt,G.shadowMap.enabled=!0,G.shadowMap.type=Eu,G.setClearColor(0,0);let te=new La,J=new jr(-2,2,2,-2,.1,40);J.position.set(0,.15,8),J.lookAt(0,0,0);let fe=new $a(16777215,6974322,2.2);te.add(fe);let Ie=new lo(16777215,2.6);Ie.position.set(-3,5,7),Ie.castShadow=!0,Ie.shadow.mapSize.set(1024,1024),Ie.shadow.camera.left=-5,Ie.shadow.camera.right=5,Ie.shadow.camera.top=5,Ie.shadow.camera.bottom=-5,Ie.shadow.normalBias=.03,te.add(Ie);let _e=new lo(13162751,1.2);_e.position.set(4,1,-2),te.add(_e);let P=new Da(p.wrapTexture);P.colorSpace=qt,P.anisotropy=Math.min(4,G.capabilities.getMaxAnisotropy());let C=new Xa({map:P,roughness:.64,metalness:0}),B=Tb(p);B.computeBoundingBox();let K=B.boundingBox.max.z-B.boundingBox.min.z;B.boundingBox=null,B.computeBoundingSphere(),B.boundingSphere.radius*=3;let Q=new rn(B,C);Q.castShadow=!0,Q.receiveShadow=!0,Q.frustumCulled=!1;let $=new Li;$.add(Q),$.rotation.set(-.08,.22,-.015),te.add($);let Ae=new rn(new Kr(30,30),new Wa({opacity:.3}));Ae.rotation.x=-Math.PI/2,Ae.position.y=-p.height/2-.22,Ae.receiveShadow=!0,te.add(Ae);let ue=Rb(p,e),be=Pb(B,ue),Le=be.rest,se=new Map,ae={scene:te,camera:J,renderer:G,mesh:Q,group:$,cage:ue,rest:Le,drags:se,cut:p,lastTime:performance.now(),accumulator:0,normalsElapsed:1/0,rendered:!1,maxDisplacement:0,peakDisplacement:0,dragCount:0,reset(){let ie=[...se.keys()];for(let oe of se.values())oe.joints.forEach(ge=>Kt.default.Composite.remove(ue.engine.world,ge));se.clear();for(let oe of ie)try{H.hasPointerCapture(oe)&&H.releasePointerCapture(oe)}catch{}ue.bodies.forEach((oe,ge)=>{Kt.default.Body.setPosition(oe,ue.rest[ge]),Kt.default.Body.setVelocity(oe,{x:0,y:0}),oe.force.x=0,oe.force.y=0}),be.reset(),this.peakDisplacement=0,this.dragCount=0,this.accumulator=0,this.lastTime=performance.now(),this.normalsElapsed=1/0}};T.current=ae;let Be=()=>{let ie=H.getBoundingClientRect();G.setSize(ie.width,ie.height,!1);let oe=ie.width/Math.max(1,ie.height),ge=Math.max(p.height+1,(p.width+.2)/(oe*Ft(e.BODY_WIDTH_RATIO,.55,.86)));J.left=-ge*oe/2,J.right=ge*oe/2,J.top=ge/2,J.bottom=-ge/2,J.updateProjectionMatrix()},Pe=new ResizeObserver(Be);Pe.observe(H),Be();let me=0,Ye=ie=>{me=requestAnimationFrame(Ye);let oe=Ft(ie-ae.lastTime,0,50);if(ae.lastTime=ie,!L.current||document.hidden){if(se.size){for(let Ce of se.values())Ce.joints.forEach(We=>Kt.default.Composite.remove(ue.engine.world,We));se.clear()}if(ae.accumulator=0,ae.rendered)return}else for(ae.accumulator=Math.min(ae.accumulator+oe,50);ae.accumulator+1e-6>=1e3/120;)Cb(ue,se),ae.accumulator=Math.max(0,ae.accumulator-1e3/120);let ge=be.apply(oe),le=B.attributes.position,j=ge.maximum;ae.normalsElapsed+=oe,ae.normalsElapsed>=1e3/30&&(B.computeVertexNormals(),ae.normalsElapsed=0),ae.maxDisplacement=j,ae.peakDisplacement=Math.max(ae.peakDisplacement,j),G.render(te,J),ae.rendered=!0,H.dataset.deformation=j.toFixed(3),H.dataset.vertices=String(le.count),H.dataset.depth=(K*ge.depthScale).toFixed(3),H.dataset.safeGradient=ge.gradientBound.toFixed(3),H.dataset.minStretch=ge.minStretch.toFixed(3),H.dataset.activeDrags=String(se.size),H.dataset.peakDeformation=ae.peakDisplacement.toFixed(3),H.dataset.completedDrags=String(ae.dragCount)};me=requestAnimationFrame(Ye);let N=ie=>{ie.preventDefault(),m("The 3D view was interrupted. Tap Trace again to rebuild.")};return H.addEventListener("webglcontextlost",N),()=>{cancelAnimationFrame(me),Pe.disconnect(),H.removeEventListener("webglcontextlost",N),ae.reset(),Kt.default.Composite.clear(ue.engine.world,!1),Kt.default.Engine.clear(ue.engine),B.dispose(),C.dispose(),P.dispose(),Ae.geometry.dispose(),Ae.material.dispose(),G.dispose(),T.current===ae&&(T.current=null)}},[i,p,e]);let pe=H=>{let G=T.current;if(!G)return null;let te=S.current.getBoundingClientRect(),J=new Se((H.clientX-te.left)/te.width*2-1,-(H.clientY-te.top)/te.height*2+1),fe=new Za;return fe.setFromCamera(J,G.camera),{w:G,ray:fe}},Te=H=>{if(!L.current||H.pointerType==="mouse"&&H.button!==0||T.current?.drags.has(H.pointerId))return;let G=pe(H);if(!G)return;let te=G.ray.intersectObject(G.w.mesh);if(!te.length)return;H.preventDefault(),H.stopPropagation();let{w:J}=G;J.group.updateMatrixWorld(!0);let fe=J.group.matrixWorld.clone().invert(),Ie=te[0].point,_e=J.group.worldToLocal(Ie.clone()),P={x:_e.x*J.cage.unit,y:-_e.y*J.cage.unit},C=J.cage.bodies.map(Q=>({body:Q,d:yb(Q.position,P)})).sort((Q,$)=>Q.d-$.d).slice(0,4),B=C.map(({body:Q})=>Kt.default.Constraint.create({bodyB:Q,pointA:{...Q.position},stiffness:.22,damping:.16}));Kt.default.Composite.add(J.cage.engine.world,B);let K=J.camera.getWorldDirection(new V);J.drags.set(H.pointerId,{joints:B,anchor:P,starts:C.map(({body:Q})=>({...Q.position})),plane:new Bn().setFromNormalAndCoplanarPoint(K,Ie),inverse:fe,target:{x:0,y:0},offset:{x:0,y:0},start:{x:H.clientX,y:H.clientY},moved:!1,last:{x:_e.x,y:_e.y}});try{H.currentTarget.setPointerCapture(H.pointerId)}catch{}h(!1),m("")},ve=H=>{let G=pe(H),te=G?.w.drags.get(H.pointerId);if(!te)return;let J=new V;G.ray.ray.intersectPlane(te.plane,J)&&(H.preventDefault(),H.stopPropagation(),J.applyMatrix4(te.inverse),te.last={x:J.x,y:J.y},te.target=Ab(J.x*G.w.cage.unit-te.anchor.x,-J.y*G.w.cage.unit-te.anchor.y),Math.hypot(H.clientX-te.start.x,H.clientY-te.start.y)>6&&(te.moved=!0))},Xe=H=>{let G=T.current,te=G?.drags.get(H.pointerId);if(te){te.joints.forEach(J=>Kt.default.Composite.remove(G.cage.engine.world,J)),G.drags.delete(H.pointerId),H.preventDefault(),H.stopPropagation();try{H.currentTarget.hasPointerCapture(H.pointerId)&&H.currentTarget.releasePointerCapture(H.pointerId)}catch{}te.moved&&H.type==="pointerup"&&(G.dragCount++,U("squish"))}},Fe=()=>{U("tap"),i==="active"?T.current?.reset():(O(),re())},I=()=>{U("tap"),r("trace"),O()},qe=Ne.default.createElement("svg",{viewBox:"0 0 24 24","aria-hidden":"true"},Ne.default.createElement("path",{d:"M5 8a7 7 0 1 1-1 7M5 4v4h4"})),De=Ne.default.createElement("svg",{viewBox:"0 0 24 24","aria-hidden":"true"},Ne.default.createElement("path",{d:"M5 15v5h14v-5M12 16V4m-4 4 4-4 4 4"}));return Ne.default.createElement("main",{className:"photo-toy phase-"+i,"data-stage":i,"data-photo-source":c?"uploaded":"sample"},Ne.default.createElement("input",{ref:g,className:"file-input",tabIndex:-1,"aria-hidden":"true",type:"file",accept:"image/*","aria-label":"Upload an image",onChange:ne}),u&&Ne.default.createElement("div",{className:"toy-guide"},i==="active"?"Press and drag to squish":c?"Trace around your subject":e.GUIDE_TEXT),Ne.default.createElement("div",{className:"photo-zone"},i==="trace"?Ne.default.createElement("canvas",{key:"trace",ref:M,"aria-label":"Draw or tap an outline around your subject",onPointerDown:Ee,onPointerMove:Ve,onPointerUp:q,onPointerCancel:q,onLostPointerCapture:q}):Ne.default.createElement("canvas",{key:"3d",ref:S,"aria-label":"3D photo squishy. Press and drag to deform it.",onPointerDown:Te,onPointerMove:ve,onPointerUp:Xe,onPointerCancel:Xe,onLostPointerCapture:Xe}),x&&Ne.default.createElement("span",{className:"load-state",role:"status"},"Opening photo\u2026")),d&&Ne.default.createElement("div",{className:"toy-error",role:"alert"},d),Ne.default.createElement("div",{className:"toy-controls"},Ne.default.createElement("button",{className:"utility","aria-label":i==="active"?e.RESET_SHAPE_LABEL:e.RESET_LABEL,onClick:Fe},qe,Ne.default.createElement("span",null,i==="active"?e.RESET_SHAPE_LABEL:e.RESET_LABEL)),Ne.default.createElement("button",{className:"utility","aria-label":e.CHOOSE_LABEL,onClick:W,disabled:x},De,Ne.default.createElement("span",null,e.CHOOSE_LABEL)),i==="trace"?Ne.default.createElement("button",{className:"make-button",disabled:!a||x,onClick:ee},e.CONFIRM_LABEL):Ne.default.createElement("button",{className:"make-button",onClick:I},"Trace again")),Ne.default.createElement("style",null,xb+Lb))}var Lb=`
@font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Regular.woff2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:Poppins;src:url('./assets/fonts/poppins/Poppins-Bold.woff2') format('woff2');font-weight:700;font-display:swap}
*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{background:#050607;color:#faf7ef;font-family:Poppins,system-ui,sans-serif;-webkit-tap-highlight-color:transparent}button{font:inherit;cursor:pointer;border:0;touch-action:manipulation}button:disabled{cursor:default}
.photo-toy{position:relative;width:100%;height:100%;overflow:hidden;background:#050607;container-type:size}.file-input{display:none}
.toy-guide{position:absolute;z-index:3;left:30px;right:30px;top:24%;transform:translateY(-50%);text-align:center;font-size:18px;line-height:1.3;font-weight:700;pointer-events:none;animation:batchBreathe 2.6s ease-in-out infinite}.photo-zone{position:absolute;left:30px;right:30px;top:31%;bottom:116px}.photo-zone canvas{display:block;width:100%;height:100%;touch-action:none;user-select:none}.phase-active .photo-zone{top:110px;background:radial-gradient(ellipse at 50% 70%,#1e2026 0%,#0d0f13 45%,#050607 76%)}.phase-active .toy-guide{top:62px}
.toy-controls{position:absolute;display:flex;align-items:center;justify-content:center;gap:8px;left:30px;right:30px;bottom:50px;min-height:46px}.utility{display:flex;align-items:center;justify-content:center;gap:5px;min-height:46px;padding:0 10px;border-radius:24px;background:#191b1f;color:#eeeae2;border:1px solid #37383c;font-size:12px;white-space:nowrap}.utility svg{width:18px;height:18px;stroke:#f4d292;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.make-button{min-height:46px;min-width:94px;padding:0 17px;border-radius:24px;background:#f3d292;color:#27231c;font-size:14px;font-weight:700;white-space:nowrap}.make-button:disabled{opacity:.35}.phase-active .utility{width:46px;min-width:46px;padding:0}.phase-active .utility span{display:none}.phase-active .make-button{flex:1;min-width:120px}.utility:active,.make-button:not(:disabled):active{transform:scale(.96)}.toy-error{position:absolute;z-index:4;left:30px;right:30px;bottom:106px;text-align:center;color:#ffd9b0;font-size:14px;line-height:1.35;background:#101216e8;padding:8px 10px;border-radius:10px}.load-state{position:absolute;inset:0;display:grid;place-items:center;background:#080a0de8;font-size:15px}
[data-feed-preview=true] .toy-controls{visibility:hidden}@media(max-width:440px){.utility{width:46px;min-width:46px;padding:0}.utility span{display:none}.toy-controls{gap:12px}.make-button{flex:1;min-width:90px}}@media(max-height:520px){.phase-active .photo-zone{top:90px}.phase-active .toy-guide{top:53px}.photo-zone{bottom:110px}}`;(0,o_.createRoot)(document.getElementById("root")).render(Ne.default.createElement(Ib,null));})();
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

matter-js/build/matter.js:
  (*!
   * matter-js 0.20.0 by @liabru
   * http://brm.io/matter-js/
   * License MIT
   * 
   * The MIT License (MIT)
   * 
   * Copyright (c) Liam Brummitt and contributors.
   * 
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   * 
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   * 
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   *)

three/build/three.core.js:
three/build/three.module.js:
  (**
   * @license
   * Copyright 2010-2025 Three.js Authors
   * SPDX-License-Identifier: MIT
   *)
*/
