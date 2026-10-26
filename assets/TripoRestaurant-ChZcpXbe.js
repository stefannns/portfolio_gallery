import{r as c,R as B}from"./index-Bao5EvEJ.js";import{j as I,O as W,ah as X,ae as G,ai as y,a7 as T,W as w,aj as L,D as j,ak as H,$ as F,H as E,al as Z,k as P,g as K,V as R,am as q,c as Y,an as $,b as N,K as J,u as ee,G as te,B as re,M as ae}from"./Gltf-XtGNb-Ns.js";class ie{constructor(){this.isPass=!0,this.enabled=!0,this.needsSwap=!0,this.clear=!1,this.renderToScreen=!1}setSize(){}render(){console.error("THREE.Pass: .render() must be implemented in derived pass.")}dispose(){}}const se=new W(-1,1,1,-1,0,1);class le extends X{constructor(){super(),this.setAttribute("position",new G([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute("uv",new G([0,2,0,0,2,0],2))}}const ne=new le;class Q{constructor(e){this._mesh=new I(ne,e)}dispose(){this._mesh.geometry.dispose()}render(e){e.render(this._mesh,se)}get material(){return this._mesh.material}set material(e){this._mesh.material=e}}const oe={uniforms:{tDiffuse:{value:null},opacity:{value:1}},vertexShader:`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		uniform float opacity;

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );
			gl_FragColor = opacity * texel;


		}`};class S extends ie{constructor(e,t,r,a){super(),this.renderScene=t,this.renderCamera=r,this.selectedObjects=a!==void 0?a:[],this.visibleEdgeColor=new y(1,1,1),this.hiddenEdgeColor=new y(.1,.04,.02),this.edgeGlow=0,this.usePatternTexture=!1,this.patternTexture=null,this.edgeThickness=1,this.edgeStrength=3,this.downSampleRatio=2,this.pulsePeriod=0,this._visibilityCache=new Map,this._selectionCache=new Set,this.resolution=e!==void 0?new T(e.x,e.y):new T(256,256);const i=Math.round(this.resolution.x/this.downSampleRatio),n=Math.round(this.resolution.y/this.downSampleRatio);this.renderTargetMaskBuffer=new w(this.resolution.x,this.resolution.y),this.renderTargetMaskBuffer.texture.name="OutlinePass.mask",this.renderTargetMaskBuffer.texture.generateMipmaps=!1,this.depthMaterial=new L,this.depthMaterial.side=j,this.depthMaterial.depthPacking=H,this.depthMaterial.blending=F,this.prepareMaskMaterial=this._getPrepareMaskMaterial(),this.prepareMaskMaterial.side=j,this.prepareMaskMaterial.fragmentShader=f(this.prepareMaskMaterial.fragmentShader,this.renderCamera),this.renderTargetDepthBuffer=new w(this.resolution.x,this.resolution.y,{type:E}),this.renderTargetDepthBuffer.texture.name="OutlinePass.depth",this.renderTargetDepthBuffer.texture.generateMipmaps=!1,this.renderTargetMaskDownSampleBuffer=new w(i,n,{type:E}),this.renderTargetMaskDownSampleBuffer.texture.name="OutlinePass.depthDownSample",this.renderTargetMaskDownSampleBuffer.texture.generateMipmaps=!1,this.renderTargetBlurBuffer1=new w(i,n,{type:E}),this.renderTargetBlurBuffer1.texture.name="OutlinePass.blur1",this.renderTargetBlurBuffer1.texture.generateMipmaps=!1,this.renderTargetBlurBuffer2=new w(Math.round(i/2),Math.round(n/2),{type:E}),this.renderTargetBlurBuffer2.texture.name="OutlinePass.blur2",this.renderTargetBlurBuffer2.texture.generateMipmaps=!1,this.edgeDetectionMaterial=this._getEdgeDetectionMaterial(),this.renderTargetEdgeBuffer1=new w(i,n,{type:E}),this.renderTargetEdgeBuffer1.texture.name="OutlinePass.edge1",this.renderTargetEdgeBuffer1.texture.generateMipmaps=!1,this.renderTargetEdgeBuffer2=new w(Math.round(i/2),Math.round(n/2),{type:E}),this.renderTargetEdgeBuffer2.texture.name="OutlinePass.edge2",this.renderTargetEdgeBuffer2.texture.generateMipmaps=!1;const u=4,d=4;this.separableBlurMaterial1=this._getSeparableBlurMaterial(u),this.separableBlurMaterial1.uniforms.texSize.value.set(i,n),this.separableBlurMaterial1.uniforms.kernelRadius.value=1,this.separableBlurMaterial2=this._getSeparableBlurMaterial(d),this.separableBlurMaterial2.uniforms.texSize.value.set(Math.round(i/2),Math.round(n/2)),this.separableBlurMaterial2.uniforms.kernelRadius.value=d,this.overlayMaterial=this._getOverlayMaterial();const l=oe;this.copyUniforms=Z.clone(l.uniforms),this.materialCopy=new P({uniforms:this.copyUniforms,vertexShader:l.vertexShader,fragmentShader:l.fragmentShader,blending:F,depthTest:!1,depthWrite:!1}),this.enabled=!0,this.needsSwap=!1,this._oldClearColor=new y,this.oldClearAlpha=1,this._fsQuad=new Q(null),this.tempPulseColor1=new y,this.tempPulseColor2=new y,this.textureMatrix=new K;function f(C,b){const p=b.isPerspectiveCamera?"perspective":"orthographic";return C.replace(/DEPTH_TO_VIEW_Z/g,p+"DepthToViewZ")}}dispose(){this.renderTargetMaskBuffer.dispose(),this.renderTargetDepthBuffer.dispose(),this.renderTargetMaskDownSampleBuffer.dispose(),this.renderTargetBlurBuffer1.dispose(),this.renderTargetBlurBuffer2.dispose(),this.renderTargetEdgeBuffer1.dispose(),this.renderTargetEdgeBuffer2.dispose(),this.depthMaterial.dispose(),this.prepareMaskMaterial.dispose(),this.edgeDetectionMaterial.dispose(),this.separableBlurMaterial1.dispose(),this.separableBlurMaterial2.dispose(),this.overlayMaterial.dispose(),this.materialCopy.dispose(),this._fsQuad.dispose()}setSize(e,t){this.renderTargetMaskBuffer.setSize(e,t),this.renderTargetDepthBuffer.setSize(e,t);let r=Math.round(e/this.downSampleRatio),a=Math.round(t/this.downSampleRatio);this.renderTargetMaskDownSampleBuffer.setSize(r,a),this.renderTargetBlurBuffer1.setSize(r,a),this.renderTargetEdgeBuffer1.setSize(r,a),this.separableBlurMaterial1.uniforms.texSize.value.set(r,a),r=Math.round(r/2),a=Math.round(a/2),this.renderTargetBlurBuffer2.setSize(r,a),this.renderTargetEdgeBuffer2.setSize(r,a),this.separableBlurMaterial2.uniforms.texSize.value.set(r,a)}render(e,t,r,a,i){if(this.selectedObjects.length>0){e.getClearColor(this._oldClearColor),this.oldClearAlpha=e.getClearAlpha();const n=e.autoClear;e.autoClear=!1,i&&e.state.buffers.stencil.setTest(!1),e.setClearColor(16777215,1),this._updateSelectionCache(),this._changeVisibilityOfSelectedObjects(!1);const u=this.renderScene.background,d=this.renderScene.overrideMaterial;if(this.renderScene.background=null,this.renderScene.overrideMaterial=this.depthMaterial,e.setRenderTarget(this.renderTargetDepthBuffer),e.clear(),e.render(this.renderScene,this.renderCamera),this._changeVisibilityOfSelectedObjects(!0),this._visibilityCache.clear(),this._updateTextureMatrix(),this._changeVisibilityOfNonSelectedObjects(!1),this.renderScene.overrideMaterial=this.prepareMaskMaterial,this.prepareMaskMaterial.uniforms.cameraNearFar.value.set(this.renderCamera.near,this.renderCamera.far),this.prepareMaskMaterial.uniforms.depthTexture.value=this.renderTargetDepthBuffer.texture,this.prepareMaskMaterial.uniforms.textureMatrix.value=this.textureMatrix,e.setRenderTarget(this.renderTargetMaskBuffer),e.clear(),e.render(this.renderScene,this.renderCamera),this._changeVisibilityOfNonSelectedObjects(!0),this._visibilityCache.clear(),this._selectionCache.clear(),this.renderScene.background=u,this.renderScene.overrideMaterial=d,this._fsQuad.material=this.materialCopy,this.copyUniforms.tDiffuse.value=this.renderTargetMaskBuffer.texture,e.setRenderTarget(this.renderTargetMaskDownSampleBuffer),e.clear(),this._fsQuad.render(e),this.tempPulseColor1.copy(this.visibleEdgeColor),this.tempPulseColor2.copy(this.hiddenEdgeColor),this.pulsePeriod>0){const l=.625+Math.cos(performance.now()*.01/this.pulsePeriod)*.75/2;this.tempPulseColor1.multiplyScalar(l),this.tempPulseColor2.multiplyScalar(l)}this._fsQuad.material=this.edgeDetectionMaterial,this.edgeDetectionMaterial.uniforms.maskTexture.value=this.renderTargetMaskDownSampleBuffer.texture,this.edgeDetectionMaterial.uniforms.texSize.value.set(this.renderTargetMaskDownSampleBuffer.width,this.renderTargetMaskDownSampleBuffer.height),this.edgeDetectionMaterial.uniforms.visibleEdgeColor.value=this.tempPulseColor1,this.edgeDetectionMaterial.uniforms.hiddenEdgeColor.value=this.tempPulseColor2,e.setRenderTarget(this.renderTargetEdgeBuffer1),e.clear(),this._fsQuad.render(e),this._fsQuad.material=this.separableBlurMaterial1,this.separableBlurMaterial1.uniforms.colorTexture.value=this.renderTargetEdgeBuffer1.texture,this.separableBlurMaterial1.uniforms.direction.value=S.BlurDirectionX,this.separableBlurMaterial1.uniforms.kernelRadius.value=this.edgeThickness,e.setRenderTarget(this.renderTargetBlurBuffer1),e.clear(),this._fsQuad.render(e),this.separableBlurMaterial1.uniforms.colorTexture.value=this.renderTargetBlurBuffer1.texture,this.separableBlurMaterial1.uniforms.direction.value=S.BlurDirectionY,e.setRenderTarget(this.renderTargetEdgeBuffer1),e.clear(),this._fsQuad.render(e),this._fsQuad.material=this.separableBlurMaterial2,this.separableBlurMaterial2.uniforms.colorTexture.value=this.renderTargetEdgeBuffer1.texture,this.separableBlurMaterial2.uniforms.direction.value=S.BlurDirectionX,e.setRenderTarget(this.renderTargetBlurBuffer2),e.clear(),this._fsQuad.render(e),this.separableBlurMaterial2.uniforms.colorTexture.value=this.renderTargetBlurBuffer2.texture,this.separableBlurMaterial2.uniforms.direction.value=S.BlurDirectionY,e.setRenderTarget(this.renderTargetEdgeBuffer2),e.clear(),this._fsQuad.render(e),this._fsQuad.material=this.overlayMaterial,this.overlayMaterial.uniforms.maskTexture.value=this.renderTargetMaskBuffer.texture,this.overlayMaterial.uniforms.edgeTexture1.value=this.renderTargetEdgeBuffer1.texture,this.overlayMaterial.uniforms.edgeTexture2.value=this.renderTargetEdgeBuffer2.texture,this.overlayMaterial.uniforms.patternTexture.value=this.patternTexture,this.overlayMaterial.uniforms.edgeStrength.value=this.edgeStrength,this.overlayMaterial.uniforms.edgeGlow.value=this.edgeGlow,this.overlayMaterial.uniforms.usePatternTexture.value=this.usePatternTexture,i&&e.state.buffers.stencil.setTest(!0),e.setRenderTarget(r),this._fsQuad.render(e),e.setClearColor(this._oldClearColor,this.oldClearAlpha),e.autoClear=n}this.renderToScreen&&(this._fsQuad.material=this.materialCopy,this.copyUniforms.tDiffuse.value=r.texture,e.setRenderTarget(null),this._fsQuad.render(e))}_updateSelectionCache(){const e=this._selectionCache;function t(r){r.isMesh&&e.add(r)}e.clear();for(let r=0;r<this.selectedObjects.length;r++)this.selectedObjects[r].traverse(t)}_changeVisibilityOfSelectedObjects(e){const t=this._visibilityCache;for(const r of this._selectionCache)e===!0?r.visible=t.get(r):(t.set(r,r.visible),r.visible=e)}_changeVisibilityOfNonSelectedObjects(e){const t=this._visibilityCache,r=this._selectionCache;function a(i){if(i.isPoints||i.isLine||i.isLine2)e===!0?i.visible=t.get(i):(t.set(i,i.visible),i.visible=e);else if((i.isMesh||i.isSprite)&&!r.has(i)){const n=i.visible;(e===!1||t.get(i)===!0)&&(i.visible=e),t.set(i,n)}}this.renderScene.traverse(a)}_updateTextureMatrix(){this.textureMatrix.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),this.textureMatrix.multiply(this.renderCamera.projectionMatrix),this.textureMatrix.multiply(this.renderCamera.matrixWorldInverse)}_getPrepareMaskMaterial(){return new P({uniforms:{depthTexture:{value:null},cameraNearFar:{value:new T(.5,.5)},textureMatrix:{value:null}},vertexShader:`#include <batching_pars_vertex>
				#include <morphtarget_pars_vertex>
				#include <skinning_pars_vertex>

				varying vec4 projTexCoord;
				varying vec4 vPosition;
				uniform mat4 textureMatrix;

				void main() {

					#include <batching_vertex>
					#include <skinbase_vertex>
					#include <begin_vertex>
					#include <morphtarget_vertex>
					#include <skinning_vertex>
					#include <project_vertex>

					vPosition = mvPosition;

					vec4 worldPosition = vec4( transformed, 1.0 );

					#ifdef USE_INSTANCING

						worldPosition = instanceMatrix * worldPosition;

					#endif

					worldPosition = modelMatrix * worldPosition;

					projTexCoord = textureMatrix * worldPosition;

				}`,fragmentShader:`#include <packing>
				varying vec4 vPosition;
				varying vec4 projTexCoord;
				uniform sampler2D depthTexture;
				uniform vec2 cameraNearFar;

				void main() {

					float depth = unpackRGBAToDepth(texture2DProj( depthTexture, projTexCoord ));
					float viewZ = - DEPTH_TO_VIEW_Z( depth, cameraNearFar.x, cameraNearFar.y );
					float depthTest = (-vPosition.z > viewZ) ? 1.0 : 0.0;
					gl_FragColor = vec4(0.0, depthTest, 1.0, 1.0);

				}`})}_getEdgeDetectionMaterial(){return new P({uniforms:{maskTexture:{value:null},texSize:{value:new T(.5,.5)},visibleEdgeColor:{value:new R(1,1,1)},hiddenEdgeColor:{value:new R(1,1,1)}},vertexShader:`varying vec2 vUv;

				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,fragmentShader:`varying vec2 vUv;

				uniform sampler2D maskTexture;
				uniform vec2 texSize;
				uniform vec3 visibleEdgeColor;
				uniform vec3 hiddenEdgeColor;

				void main() {
					vec2 invSize = 1.0 / texSize;
					vec4 uvOffset = vec4(1.0, 0.0, 0.0, 1.0) * vec4(invSize, invSize);
					vec4 c1 = texture2D( maskTexture, vUv + uvOffset.xy);
					vec4 c2 = texture2D( maskTexture, vUv - uvOffset.xy);
					vec4 c3 = texture2D( maskTexture, vUv + uvOffset.yw);
					vec4 c4 = texture2D( maskTexture, vUv - uvOffset.yw);
					float diff1 = (c1.r - c2.r)*0.5;
					float diff2 = (c3.r - c4.r)*0.5;
					float d = length( vec2(diff1, diff2) );
					float a1 = min(c1.g, c2.g);
					float a2 = min(c3.g, c4.g);
					float visibilityFactor = min(a1, a2);
					vec3 edgeColor = 1.0 - visibilityFactor > 0.001 ? visibleEdgeColor : hiddenEdgeColor;
					gl_FragColor = vec4(edgeColor, 1.0) * vec4(d);
				}`})}_getSeparableBlurMaterial(e){return new P({defines:{MAX_RADIUS:e},uniforms:{colorTexture:{value:null},texSize:{value:new T(.5,.5)},direction:{value:new T(.5,.5)},kernelRadius:{value:1}},vertexShader:`varying vec2 vUv;

				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,fragmentShader:`#include <common>
				varying vec2 vUv;
				uniform sampler2D colorTexture;
				uniform vec2 texSize;
				uniform vec2 direction;
				uniform float kernelRadius;

				float gaussianPdf(in float x, in float sigma) {
					return 0.39894 * exp( -0.5 * x * x/( sigma * sigma))/sigma;
				}

				void main() {
					vec2 invSize = 1.0 / texSize;
					float sigma = kernelRadius/2.0;
					float weightSum = gaussianPdf(0.0, sigma);
					vec4 diffuseSum = texture2D( colorTexture, vUv) * weightSum;
					vec2 delta = direction * invSize * kernelRadius/float(MAX_RADIUS);
					vec2 uvOffset = delta;
					for( int i = 1; i <= MAX_RADIUS; i ++ ) {
						float x = kernelRadius * float(i) / float(MAX_RADIUS);
						float w = gaussianPdf(x, sigma);
						vec4 sample1 = texture2D( colorTexture, vUv + uvOffset);
						vec4 sample2 = texture2D( colorTexture, vUv - uvOffset);
						diffuseSum += ((sample1 + sample2) * w);
						weightSum += (2.0 * w);
						uvOffset += delta;
					}
					gl_FragColor = diffuseSum/weightSum;
				}`})}_getOverlayMaterial(){return new P({uniforms:{maskTexture:{value:null},edgeTexture1:{value:null},edgeTexture2:{value:null},patternTexture:{value:null},edgeStrength:{value:1},edgeGlow:{value:1},usePatternTexture:{value:0}},vertexShader:`varying vec2 vUv;

				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,fragmentShader:`varying vec2 vUv;

				uniform sampler2D maskTexture;
				uniform sampler2D edgeTexture1;
				uniform sampler2D edgeTexture2;
				uniform sampler2D patternTexture;
				uniform float edgeStrength;
				uniform float edgeGlow;
				uniform bool usePatternTexture;

				void main() {
					vec4 edgeValue1 = texture2D(edgeTexture1, vUv);
					vec4 edgeValue2 = texture2D(edgeTexture2, vUv);
					vec4 maskColor = texture2D(maskTexture, vUv);
					vec4 patternColor = texture2D(patternTexture, 6.0 * vUv);
					float visibilityFactor = 1.0 - maskColor.g > 0.0 ? 1.0 : 0.5;
					vec4 edgeValue = edgeValue1 + edgeValue2 * edgeGlow;
					vec4 finalColor = edgeStrength * maskColor.r * edgeValue;
					if(usePatternTexture)
						finalColor += + visibilityFactor * (1.0 - maskColor.r) * (1.0 - patternColor.r);
					gl_FragColor = finalColor;
				}`,blending:q,depthTest:!1,depthWrite:!1,transparent:!0})}}S.BlurDirectionX=new T(1,0);S.BlurDirectionY=new T(0,1);function ue(s,e){s.updateWorldMatrix(!0,!1);const t=s.matrixWorldInverse.elements,r=-(t[6]*.8+t[14]),a=e.height*s.projectionMatrix.elements[5]/2/(s.isOrthographicCamera?1:Math.max(.01,r));return Math.max(.01,a/100)}const V=c.createContext(null);class de extends S{constructor(e,t,r,a){super(e,t,r,[]),this.ignoredObjects=a,this.ignoredVisibility=new Map,this.hiddenEdgeColor.set(0),this.visibleEdgeColor.set(16777215),this.usePatternTexture=!1,this.renderTargetDepthBuffer.texture.type=J,this.overlayMaterial.blending=F,this.separableBlurMaterial2.uniforms.kernelRadius.value=3.5}render(e,t,r,a,i){for(const d of this.ignoredObjects)this.ignoredVisibility.set(d,d.visible),d.visible=!1;const n=e.shadowMap.autoUpdate,u=e.shadowMap.needsUpdate;e.shadowMap.autoUpdate=!1,e.shadowMap.needsUpdate=!1;try{super.render(e,t,r,a,i)}finally{e.shadowMap.autoUpdate=n,e.shadowMap.needsUpdate=u;for(const[d,l]of this.ignoredVisibility)d.visible=l;this.ignoredVisibility.clear()}}}function he(s,e,t){const r=c.useContext(V),a=c.useMemo(()=>({object:s,objective:e,highlighted:t}),[s]);c.useLayoutEffect(()=>{a.objective=e,a.highlighted=t},[a,e,t]),c.useLayoutEffect(()=>{if(r)return r.models.add(a),()=>r.models.delete(a)},[r,a])}function me(){const s=c.useContext(V),e=c.useRef(null);return c.useCallback(t=>{e.current&&s?.ignored.delete(e.current),e.current=t,t&&s?.ignored.add(t)},[s])}function fe({registry:s,reducedMotion:e}){const{gl:t,scene:r,camera:a}=Y(),i=c.useRef(null);return c.useEffect(()=>{const n=new de(new T(1,1),r,a,s.ignored),u=new w(1,1,{type:E,depthBuffer:!1});u.texture.name="KitchenTaskOutline.overlay";const d=new P({uniforms:{edgeTexture:{value:u.texture},outlineColor:{value:new y("#ffc52a")},outlineOpacity:{value:.9}},vertexShader:`varying vec2 vUv;
        void main() {vUv = uv;gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);}`,fragmentShader:`varying vec2 vUv;uniform sampler2D edgeTexture;
        uniform vec3 outlineColor;uniform float outlineOpacity;
        void main() {
          vec3 edge = texture2D(edgeTexture, vUv).rgb;
          float coverage = clamp(max(max(edge.r, edge.g), edge.b), 0.0, 1.0);
          gl_FragColor = vec4(outlineColor, coverage * outlineOpacity);
          #include <colorspace_fragment>
        }`,blending:$,transparent:!0,depthTest:!1,depthWrite:!1,toneMapped:!1}),l=new Q(d);return i.current={outline:n,target:u,material:d,quad:l,clearColor:new y,width:0,height:0,pixelRatio:0},()=>{i.current=null,n.dispose(),u.dispose(),d.dispose(),l.dispose()}},[t,r,a,s]),N(({clock:n,size:u},d)=>{const l=i.current;if(!l){t.render(r,a);return}const{outline:f,target:C,quad:b}=l,p=t.getPixelRatio();if(l.width!==u.width||l.height!==u.height||l.pixelRatio!==p){const h=Math.max(1,Math.round(u.width*p)),m=Math.max(1,Math.round(u.height*p));C.setSize(h,m),f.setSize(h,m),l.width=u.width,l.height=u.height,l.pixelRatio=p}const _=f.selectedObjects;_.length=0;let k=!1;for(const h of s.models)!h.objective&&!h.highlighted||!h.object.visible||(_.push(h.object),k||=h.highlighted);if(t.render(r,a),!_.length)return;const D=e?.5:.5+Math.sin(n.elapsedTime*2.6)*.5,z=Math.max(.8,ue(a,u));f.edgeThickness=Math.min(4,(k?2.1:1.7+D*.5)*z*p),f.edgeStrength=k?6.3:4.1+D*1.7,f.edgeGlow=1.05+D*1.05,l.material.uniforms.outlineOpacity.value=k?1:.82+D*.16;const o=t.autoClear,v=t.getClearAlpha();t.getClearColor(l.clearColor);try{t.setRenderTarget(C),t.setClearColor(0,0),t.clear(),t.setClearColor(l.clearColor,v),f.render(t,null,C,d,!1),t.setRenderTarget(null),t.autoClear=!1,b.render(t)}finally{t.setRenderTarget(null),t.setClearColor(l.clearColor,v),t.autoClear=o}},1),null}function xe({children:s,reducedMotion:e}){const t=c.useMemo(()=>({models:new Set,ignored:new Set}),[]);return B.createElement(V.Provider,{value:t},s,B.createElement(fe,{registry:t,reducedMotion:e}))}const A=new y("#ffe066");class ce extends B.Component{state={failed:!1};static getDerivedStateFromError(){return{failed:!0}}componentDidCatch(e){this.props.onError?.(e)}render(){return this.state.failed?null:this.props.children}}function ge({url:s,dimensions:e=[],position:t,rotationY:r,uniform:a,objective:i,highlighted:n,reducedMotion:u,required:d=!1}){const{scene:l}=ee(s,"/draco/"),f=c.useRef(0),{object:C,size:b,materials:p}=c.useMemo(()=>{const o=new te,v=l.clone(!0),h=new Map,m=g=>{if(!g)return g;if(!h.has(g)){const U=g.clone();h.set(g,{material:U,emissive:U.emissive?.clone(),emissiveMap:U.emissiveMap,intensity:U.emissiveIntensity??1})}return h.get(g).material};v.traverse(g=>{g.isMesh&&(g.castShadow=!0,g.receiveShadow=!0,g.material=Array.isArray(g.material)?g.material.map(m):m(g.material))}),o.add(v),o.rotation.y=r,o.updateMatrixWorld(!0);const x=new re().setFromObject(o),M=x.getSize(new R),O=x.getCenter(new R);if(d&&(x.isEmpty()||!Number.isFinite(M.x+M.y+M.z)||Math.max(M.x,M.y,M.z)<=0))throw new Error(`The object model contains no visible geometry: ${s}`);return x.isEmpty()||o.position.set(-O.x,-x.min.y,-O.z),{object:o,size:M,materials:[...h.values()]}},[l,r,d,s]);he(C,i,n),c.useEffect(()=>()=>{p.forEach(({material:o})=>o.dispose())},[p]),c.useEffect(()=>{for(const{material:o,emissive:v,emissiveMap:h}of p){if(!v)continue;const m=n||i?h||o.map:h;o.emissiveMap!==m&&(o.emissiveMap=m,o.needsUpdate=!0)}},[n,i,p]),N(({clock:o},v)=>{const h=u?.5:.5+Math.sin(o.elapsedTime*2.6)*.5,m=n?.34+h*.14:i?.22+h*.24:0;f.current=u?m:ae.damp(f.current,m,9,Math.min(v,.05)),f.current<.001&&(f.current=0);for(const{material:x,emissive:M,intensity:O}of p)M&&(x.emissive.copy(M),x.emissive.r+=A.r*f.current,x.emissive.g+=A.g*f.current,x.emissive.b+=A.b*f.current,x.emissiveIntensity=O+f.current*.25)});const _=(o,v)=>Number.isFinite(o)&&o>0&&v>1e-6?o/v:null,k=[_(e[0],b.x),_(e[1],b.y),_(e[2],b.z)],D=Math.min(...k.filter(o=>o!==null),1/0),z=a?Number.isFinite(D)?D:1:k.map(o=>o??1);return B.createElement("group",{position:t,scale:z},B.createElement("primitive",{object:C,dispose:null}))}function Me({entry:s,dimensions:e,position:t=[0,0,0],rotationY:r=-Math.PI/2,uniform:a=!0,objective:i=!1,highlighted:n=!1,reducedMotion:u=!1,onError:d}){return s?.url?B.createElement(ce,{key:s.url,onError:d},B.createElement(c.Suspense,{fallback:null},B.createElement(ge,{url:s.url,dimensions:e,position:t,rotationY:r,uniform:a,objective:i,highlighted:n,reducedMotion:u,required:!!d}))):null}export{Me as R,xe as T,ue as g,me as u};
