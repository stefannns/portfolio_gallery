import{r as f,R as b}from"./index-BKyt9NX4.js";import{j as I,O as H,am as Z,aj as N,ac as S,a7 as x,W as C,an as q,D as Q,ao as K,$ as V,H as E,ap as Y,k as R,g as W,V as P,aq as $,c as J,ar as ee,b as L,K as te,T as re,f as ae,q as ie,x as se,u as le,G as ne,B as oe,M as ue}from"./Gltf-Db7KZKe5.js";class de{constructor(){this.isPass=!0,this.enabled=!0,this.needsSwap=!0,this.clear=!1,this.renderToScreen=!1}setSize(){}render(){console.error("THREE.Pass: .render() must be implemented in derived pass.")}dispose(){}}const he=new H(-1,1,1,-1,0,1);class ce extends Z{constructor(){super(),this.setAttribute("position",new N([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute("uv",new N([0,2,0,0,2,0],2))}}const fe=new ce;class X{constructor(e){this._mesh=new I(fe,e)}dispose(){this._mesh.geometry.dispose()}render(e){e.render(this._mesh,he)}get material(){return this._mesh.material}set material(e){this._mesh.material=e}}const pe={uniforms:{tDiffuse:{value:null},opacity:{value:1}},vertexShader:`

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


		}`};class B extends de{constructor(e,t,r,a){super(),this.renderScene=t,this.renderCamera=r,this.selectedObjects=a!==void 0?a:[],this.visibleEdgeColor=new S(1,1,1),this.hiddenEdgeColor=new S(.1,.04,.02),this.edgeGlow=0,this.usePatternTexture=!1,this.patternTexture=null,this.edgeThickness=1,this.edgeStrength=3,this.downSampleRatio=2,this.pulsePeriod=0,this._visibilityCache=new Map,this._selectionCache=new Set,this.resolution=e!==void 0?new x(e.x,e.y):new x(256,256);const i=Math.round(this.resolution.x/this.downSampleRatio),l=Math.round(this.resolution.y/this.downSampleRatio);this.renderTargetMaskBuffer=new C(this.resolution.x,this.resolution.y),this.renderTargetMaskBuffer.texture.name="OutlinePass.mask",this.renderTargetMaskBuffer.texture.generateMipmaps=!1,this.depthMaterial=new q,this.depthMaterial.side=Q,this.depthMaterial.depthPacking=K,this.depthMaterial.blending=V,this.prepareMaskMaterial=this._getPrepareMaskMaterial(),this.prepareMaskMaterial.side=Q,this.prepareMaskMaterial.fragmentShader=c(this.prepareMaskMaterial.fragmentShader,this.renderCamera),this.renderTargetDepthBuffer=new C(this.resolution.x,this.resolution.y,{type:E}),this.renderTargetDepthBuffer.texture.name="OutlinePass.depth",this.renderTargetDepthBuffer.texture.generateMipmaps=!1,this.renderTargetMaskDownSampleBuffer=new C(i,l,{type:E}),this.renderTargetMaskDownSampleBuffer.texture.name="OutlinePass.depthDownSample",this.renderTargetMaskDownSampleBuffer.texture.generateMipmaps=!1,this.renderTargetBlurBuffer1=new C(i,l,{type:E}),this.renderTargetBlurBuffer1.texture.name="OutlinePass.blur1",this.renderTargetBlurBuffer1.texture.generateMipmaps=!1,this.renderTargetBlurBuffer2=new C(Math.round(i/2),Math.round(l/2),{type:E}),this.renderTargetBlurBuffer2.texture.name="OutlinePass.blur2",this.renderTargetBlurBuffer2.texture.generateMipmaps=!1,this.edgeDetectionMaterial=this._getEdgeDetectionMaterial(),this.renderTargetEdgeBuffer1=new C(i,l,{type:E}),this.renderTargetEdgeBuffer1.texture.name="OutlinePass.edge1",this.renderTargetEdgeBuffer1.texture.generateMipmaps=!1,this.renderTargetEdgeBuffer2=new C(Math.round(i/2),Math.round(l/2),{type:E}),this.renderTargetEdgeBuffer2.texture.name="OutlinePass.edge2",this.renderTargetEdgeBuffer2.texture.generateMipmaps=!1;const u=4,d=4;this.separableBlurMaterial1=this._getSeparableBlurMaterial(u),this.separableBlurMaterial1.uniforms.texSize.value.set(i,l),this.separableBlurMaterial1.uniforms.kernelRadius.value=1,this.separableBlurMaterial2=this._getSeparableBlurMaterial(d),this.separableBlurMaterial2.uniforms.texSize.value.set(Math.round(i/2),Math.round(l/2)),this.separableBlurMaterial2.uniforms.kernelRadius.value=d,this.overlayMaterial=this._getOverlayMaterial();const n=pe;this.copyUniforms=Y.clone(n.uniforms),this.materialCopy=new R({uniforms:this.copyUniforms,vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,blending:V,depthTest:!1,depthWrite:!1}),this.enabled=!0,this.needsSwap=!1,this._oldClearColor=new S,this.oldClearAlpha=1,this._fsQuad=new X(null),this.tempPulseColor1=new S,this.tempPulseColor2=new S,this.textureMatrix=new W;function c(M,_){const g=_.isPerspectiveCamera?"perspective":"orthographic";return M.replace(/DEPTH_TO_VIEW_Z/g,g+"DepthToViewZ")}}dispose(){this.renderTargetMaskBuffer.dispose(),this.renderTargetDepthBuffer.dispose(),this.renderTargetMaskDownSampleBuffer.dispose(),this.renderTargetBlurBuffer1.dispose(),this.renderTargetBlurBuffer2.dispose(),this.renderTargetEdgeBuffer1.dispose(),this.renderTargetEdgeBuffer2.dispose(),this.depthMaterial.dispose(),this.prepareMaskMaterial.dispose(),this.edgeDetectionMaterial.dispose(),this.separableBlurMaterial1.dispose(),this.separableBlurMaterial2.dispose(),this.overlayMaterial.dispose(),this.materialCopy.dispose(),this._fsQuad.dispose()}setSize(e,t){this.renderTargetMaskBuffer.setSize(e,t),this.renderTargetDepthBuffer.setSize(e,t);let r=Math.round(e/this.downSampleRatio),a=Math.round(t/this.downSampleRatio);this.renderTargetMaskDownSampleBuffer.setSize(r,a),this.renderTargetBlurBuffer1.setSize(r,a),this.renderTargetEdgeBuffer1.setSize(r,a),this.separableBlurMaterial1.uniforms.texSize.value.set(r,a),r=Math.round(r/2),a=Math.round(a/2),this.renderTargetBlurBuffer2.setSize(r,a),this.renderTargetEdgeBuffer2.setSize(r,a),this.separableBlurMaterial2.uniforms.texSize.value.set(r,a)}render(e,t,r,a,i){if(this.selectedObjects.length>0){e.getClearColor(this._oldClearColor),this.oldClearAlpha=e.getClearAlpha();const l=e.autoClear;e.autoClear=!1,i&&e.state.buffers.stencil.setTest(!1),e.setClearColor(16777215,1),this._updateSelectionCache(),this._changeVisibilityOfSelectedObjects(!1);const u=this.renderScene.background,d=this.renderScene.overrideMaterial;if(this.renderScene.background=null,this.renderScene.overrideMaterial=this.depthMaterial,e.setRenderTarget(this.renderTargetDepthBuffer),e.clear(),e.render(this.renderScene,this.renderCamera),this._changeVisibilityOfSelectedObjects(!0),this._visibilityCache.clear(),this._updateTextureMatrix(),this._changeVisibilityOfNonSelectedObjects(!1),this.renderScene.overrideMaterial=this.prepareMaskMaterial,this.prepareMaskMaterial.uniforms.cameraNearFar.value.set(this.renderCamera.near,this.renderCamera.far),this.prepareMaskMaterial.uniforms.depthTexture.value=this.renderTargetDepthBuffer.texture,this.prepareMaskMaterial.uniforms.textureMatrix.value=this.textureMatrix,e.setRenderTarget(this.renderTargetMaskBuffer),e.clear(),e.render(this.renderScene,this.renderCamera),this._changeVisibilityOfNonSelectedObjects(!0),this._visibilityCache.clear(),this._selectionCache.clear(),this.renderScene.background=u,this.renderScene.overrideMaterial=d,this._fsQuad.material=this.materialCopy,this.copyUniforms.tDiffuse.value=this.renderTargetMaskBuffer.texture,e.setRenderTarget(this.renderTargetMaskDownSampleBuffer),e.clear(),this._fsQuad.render(e),this.tempPulseColor1.copy(this.visibleEdgeColor),this.tempPulseColor2.copy(this.hiddenEdgeColor),this.pulsePeriod>0){const n=.625+Math.cos(performance.now()*.01/this.pulsePeriod)*.75/2;this.tempPulseColor1.multiplyScalar(n),this.tempPulseColor2.multiplyScalar(n)}this._fsQuad.material=this.edgeDetectionMaterial,this.edgeDetectionMaterial.uniforms.maskTexture.value=this.renderTargetMaskDownSampleBuffer.texture,this.edgeDetectionMaterial.uniforms.texSize.value.set(this.renderTargetMaskDownSampleBuffer.width,this.renderTargetMaskDownSampleBuffer.height),this.edgeDetectionMaterial.uniforms.visibleEdgeColor.value=this.tempPulseColor1,this.edgeDetectionMaterial.uniforms.hiddenEdgeColor.value=this.tempPulseColor2,e.setRenderTarget(this.renderTargetEdgeBuffer1),e.clear(),this._fsQuad.render(e),this._fsQuad.material=this.separableBlurMaterial1,this.separableBlurMaterial1.uniforms.colorTexture.value=this.renderTargetEdgeBuffer1.texture,this.separableBlurMaterial1.uniforms.direction.value=B.BlurDirectionX,this.separableBlurMaterial1.uniforms.kernelRadius.value=this.edgeThickness,e.setRenderTarget(this.renderTargetBlurBuffer1),e.clear(),this._fsQuad.render(e),this.separableBlurMaterial1.uniforms.colorTexture.value=this.renderTargetBlurBuffer1.texture,this.separableBlurMaterial1.uniforms.direction.value=B.BlurDirectionY,e.setRenderTarget(this.renderTargetEdgeBuffer1),e.clear(),this._fsQuad.render(e),this._fsQuad.material=this.separableBlurMaterial2,this.separableBlurMaterial2.uniforms.colorTexture.value=this.renderTargetEdgeBuffer1.texture,this.separableBlurMaterial2.uniforms.direction.value=B.BlurDirectionX,e.setRenderTarget(this.renderTargetBlurBuffer2),e.clear(),this._fsQuad.render(e),this.separableBlurMaterial2.uniforms.colorTexture.value=this.renderTargetBlurBuffer2.texture,this.separableBlurMaterial2.uniforms.direction.value=B.BlurDirectionY,e.setRenderTarget(this.renderTargetEdgeBuffer2),e.clear(),this._fsQuad.render(e),this._fsQuad.material=this.overlayMaterial,this.overlayMaterial.uniforms.maskTexture.value=this.renderTargetMaskBuffer.texture,this.overlayMaterial.uniforms.edgeTexture1.value=this.renderTargetEdgeBuffer1.texture,this.overlayMaterial.uniforms.edgeTexture2.value=this.renderTargetEdgeBuffer2.texture,this.overlayMaterial.uniforms.patternTexture.value=this.patternTexture,this.overlayMaterial.uniforms.edgeStrength.value=this.edgeStrength,this.overlayMaterial.uniforms.edgeGlow.value=this.edgeGlow,this.overlayMaterial.uniforms.usePatternTexture.value=this.usePatternTexture,i&&e.state.buffers.stencil.setTest(!0),e.setRenderTarget(r),this._fsQuad.render(e),e.setClearColor(this._oldClearColor,this.oldClearAlpha),e.autoClear=l}this.renderToScreen&&(this._fsQuad.material=this.materialCopy,this.copyUniforms.tDiffuse.value=r.texture,e.setRenderTarget(null),this._fsQuad.render(e))}_updateSelectionCache(){const e=this._selectionCache;function t(r){r.isMesh&&e.add(r)}e.clear();for(let r=0;r<this.selectedObjects.length;r++)this.selectedObjects[r].traverse(t)}_changeVisibilityOfSelectedObjects(e){const t=this._visibilityCache;for(const r of this._selectionCache)e===!0?r.visible=t.get(r):(t.set(r,r.visible),r.visible=e)}_changeVisibilityOfNonSelectedObjects(e){const t=this._visibilityCache,r=this._selectionCache;function a(i){if(i.isPoints||i.isLine||i.isLine2)e===!0?i.visible=t.get(i):(t.set(i,i.visible),i.visible=e);else if((i.isMesh||i.isSprite)&&!r.has(i)){const l=i.visible;(e===!1||t.get(i)===!0)&&(i.visible=e),t.set(i,l)}}this.renderScene.traverse(a)}_updateTextureMatrix(){this.textureMatrix.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),this.textureMatrix.multiply(this.renderCamera.projectionMatrix),this.textureMatrix.multiply(this.renderCamera.matrixWorldInverse)}_getPrepareMaskMaterial(){return new R({uniforms:{depthTexture:{value:null},cameraNearFar:{value:new x(.5,.5)},textureMatrix:{value:null}},vertexShader:`#include <batching_pars_vertex>
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

				}`})}_getEdgeDetectionMaterial(){return new R({uniforms:{maskTexture:{value:null},texSize:{value:new x(.5,.5)},visibleEdgeColor:{value:new P(1,1,1)},hiddenEdgeColor:{value:new P(1,1,1)}},vertexShader:`varying vec2 vUv;

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
				}`})}_getSeparableBlurMaterial(e){return new R({defines:{MAX_RADIUS:e},uniforms:{colorTexture:{value:null},texSize:{value:new x(.5,.5)},direction:{value:new x(.5,.5)},kernelRadius:{value:1}},vertexShader:`varying vec2 vUv;

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
				}`})}_getOverlayMaterial(){return new R({uniforms:{maskTexture:{value:null},edgeTexture1:{value:null},edgeTexture2:{value:null},patternTexture:{value:null},edgeStrength:{value:1},edgeGlow:{value:1},usePatternTexture:{value:0}},vertexShader:`varying vec2 vUv;

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
				}`,blending:$,depthTest:!1,depthWrite:!1,transparent:!0})}}B.BlurDirectionX=new x(1,0);B.BlurDirectionY=new x(0,1);function ge(s,e){s.updateWorldMatrix(!0,!1);const t=s.matrixWorldInverse.elements,r=-(t[6]*.8+t[14]),a=e.height*s.projectionMatrix.elements[5]/2/(s.isOrthographicCamera?1:Math.max(.01,r));return Math.max(.01,a/100)}const G=f.createContext(null);class ve extends B{constructor(e,t,r,a){super(e,t,r,[]),this.ignoredObjects=a,this.ignoredVisibility=new Map,this.hiddenEdgeColor.set(0),this.visibleEdgeColor.set(16777215),this.usePatternTexture=!1,this.renderTargetDepthBuffer.texture.type=te,this.overlayMaterial.blending=V,this.separableBlurMaterial2.uniforms.kernelRadius.value=3.5}render(e,t,r,a,i){for(const d of this.ignoredObjects)this.ignoredVisibility.set(d,d.visible),d.visible=!1;const l=e.shadowMap.autoUpdate,u=e.shadowMap.needsUpdate;e.shadowMap.autoUpdate=!1,e.shadowMap.needsUpdate=!1;try{super.render(e,t,r,a,i)}finally{e.shadowMap.autoUpdate=l,e.shadowMap.needsUpdate=u;for(const[d,n]of this.ignoredVisibility)d.visible=n;this.ignoredVisibility.clear()}}}function me(s,e,t){const r=f.useContext(G),a=f.useMemo(()=>({object:s,objective:e,highlighted:t}),[s]);f.useLayoutEffect(()=>{a.objective=e,a.highlighted=t},[a,e,t]),f.useLayoutEffect(()=>{if(r)return r.models.add(a),()=>r.models.delete(a)},[r,a])}function Se(){const s=f.useContext(G),e=f.useRef(null);return f.useCallback(t=>{e.current&&s?.ignored.delete(e.current),e.current=t,t&&s?.ignored.add(t)},[s])}function xe({registry:s,reducedMotion:e}){const{gl:t,scene:r,camera:a}=J(),i=f.useRef(null);return f.useEffect(()=>{const l=new ve(new x(1,1),r,a,s.ignored),u=new C(1,1,{type:E,depthBuffer:!1});u.texture.name="KitchenTaskOutline.overlay";const d=new R({uniforms:{edgeTexture:{value:u.texture},outlineColor:{value:new S("#ffc52a")},outlineOpacity:{value:.9}},vertexShader:`varying vec2 vUv;
        void main() {vUv = uv;gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);}`,fragmentShader:`varying vec2 vUv;uniform sampler2D edgeTexture;
        uniform vec3 outlineColor;uniform float outlineOpacity;
        void main() {
          vec3 edge = texture2D(edgeTexture, vUv).rgb;
          float coverage = clamp(max(max(edge.r, edge.g), edge.b), 0.0, 1.0);
          gl_FragColor = vec4(outlineColor, coverage * outlineOpacity);
          #include <colorspace_fragment>
        }`,blending:ee,transparent:!0,depthTest:!1,depthWrite:!1,toneMapped:!1}),n=new X(d);return i.current={outline:l,target:u,material:d,quad:n,clearColor:new S,width:0,height:0,pixelRatio:0},()=>{i.current=null,l.dispose(),u.dispose(),d.dispose(),n.dispose()}},[t,r,a,s]),L(({clock:l,size:u},d)=>{const n=i.current;if(!n){t.render(r,a);return}const{outline:c,target:M,quad:_}=n,g=t.getPixelRatio();if(n.width!==u.width||n.height!==u.height||n.pixelRatio!==g){const h=Math.max(1,Math.round(u.width*g)),v=Math.max(1,Math.round(u.height*g));M.setSize(h,v),c.setSize(h,v),n.width=u.width,n.height=u.height,n.pixelRatio=g}const O=c.selectedObjects;O.length=0;let T=!1;for(const h of s.models)!h.objective&&!h.highlighted||!h.object.visible||(O.push(h.object),T||=h.highlighted);if(t.render(r,a),!O.length)return;const k=e?.5:.5+Math.sin(l.elapsedTime*2.6)*.5,z=Math.max(.8,ge(a,u));c.edgeThickness=Math.min(4,(T?2.1:1.7+k*.5)*z*g),c.edgeStrength=T?6.3:4.1+k*1.7,c.edgeGlow=1.05+k*1.05,n.material.uniforms.outlineOpacity.value=T?1:.82+k*.16;const F=t.autoClear,o=t.getClearAlpha();t.getClearColor(n.clearColor);try{t.setRenderTarget(M),t.setClearColor(0,0),t.clear(),t.setClearColor(n.clearColor,o),c.render(t,null,M,d,!1),t.setRenderTarget(null),t.autoClear=!1,_.render(t)}finally{t.setRenderTarget(null),t.setClearColor(n.clearColor,o),t.autoClear=F}},1),null}function Be({children:s,reducedMotion:e}){const t=f.useMemo(()=>({models:new Set,ignored:new Set}),[]);return b.createElement(G.Provider,{value:t},s,b.createElement(xe,{registry:t,reducedMotion:e}))}function Me(s){const e=new re().load("/images/scene/chalk-cutlery.svg");e.colorSpace=ae;const t=new ie(.32,.38),r=new se({map:e,transparent:!0,opacity:.9,depthTest:!0,depthWrite:!1,alphaTest:.01,toneMapped:!1,polygonOffset:!0,polygonOffsetFactor:-1,polygonOffsetUnits:-1}),a=new I(t,r);a.name="chalk-spoon-and-fork";const i=new P(.95448,.29827,0).normalize(),l=new P(0,0,-1),u=new P(-i.y,i.x,0);return a.quaternion.setFromRotationMatrix(new W().makeBasis(l,u,i)),a.position.set(-.0139,.12,-.04).addScaledVector(i,.003),a.raycast=()=>{},s.add(a),()=>{s.remove(a),t.dispose(),r.dispose(),e.dispose()}}const A=new S("#ffe066");class Te extends b.Component{state={failed:!1};static getDerivedStateFromError(){return{failed:!0}}componentDidCatch(e){this.props.onError?.(e)}render(){return this.state.failed?null:this.props.children}}function ye({url:s,dimensions:e=[],position:t,rotationY:r,uniform:a,objective:i,highlighted:l,reducedMotion:u,required:d=!1}){const{scene:n}=le(s,"/draco/"),c=f.useRef(0),{object:M,size:_,materials:g,disposeDetails:O}=f.useMemo(()=>{const o=new ne,h=n.clone(!0),v=new Map,y=p=>{if(!p)return p;if(!v.has(p)){const U=p.clone();v.set(p,{material:U,emissive:U.emissive?.clone(),emissiveMap:U.emissiveMap,intensity:U.emissiveIntensity??1})}return v.get(p).material};h.traverse(p=>{p.isMesh&&(p.castShadow=!0,p.receiveShadow=!0,p.material=Array.isArray(p.material)?p.material.map(U=>y(U)):y(p.material))});const D=s.endsWith("/discovery-bot-v3.glb")?Me(h):()=>{};o.add(h),o.rotation.y=r,o.updateMatrixWorld(!0);const w=new oe().setFromObject(o),m=w.getSize(new P),j=w.getCenter(new P);if(d&&(w.isEmpty()||!Number.isFinite(m.x+m.y+m.z)||Math.max(m.x,m.y,m.z)<=0))throw new Error(`The object model contains no visible geometry: ${s}`);return w.isEmpty()||o.position.set(-j.x,-w.min.y,-j.z),{object:o,size:m,materials:[...v.values()],disposeDetails:D}},[n,r,d,s]);me(M,i,l),f.useEffect(()=>()=>{g.forEach(({material:o})=>o.dispose()),O()},[g,O]),f.useEffect(()=>{for(const{material:o,emissive:h,emissiveMap:v}of g){if(!h)continue;const y=l||i?v||o.map:v;o.emissiveMap!==y&&(o.emissiveMap=y,o.needsUpdate=!0)}},[l,i,g]),L(({clock:o},h)=>{const v=u?.5:.5+Math.sin(o.elapsedTime*2.6)*.5,y=l?.34+v*.14:i?.22+v*.24:0;c.current=u?y:ue.damp(c.current,y,9,Math.min(h,.05)),c.current<.001&&(c.current=0);for(const{material:D,emissive:w,intensity:m}of g)w&&(D.emissive.copy(w),D.emissive.r+=A.r*c.current,D.emissive.g+=A.g*c.current,D.emissive.b+=A.b*c.current,D.emissiveIntensity=m+c.current*.25)});const T=(o,h)=>Number.isFinite(o)&&o>0&&h>1e-6?o/h:null,k=[T(e[0],_.x),T(e[1],_.y),T(e[2],_.z)],z=Math.min(...k.filter(o=>o!==null),1/0),F=a?Number.isFinite(z)?z:1:k.map(o=>o??1);return b.createElement("group",{position:t,scale:F},b.createElement("primitive",{object:M,dispose:null}))}function be({entry:s,dimensions:e,position:t=[0,0,0],rotationY:r=-Math.PI/2,uniform:a=!0,objective:i=!1,highlighted:l=!1,reducedMotion:u=!1,onError:d}){return s?.url?b.createElement(Te,{key:s.url,onError:d},b.createElement(f.Suspense,{fallback:null},b.createElement(ye,{url:s.url,dimensions:e,position:t,rotationY:r,uniform:a,objective:i,highlighted:l,reducedMotion:u,required:!!d}))):null}export{be as R,Be as T,me as a,ge as g,Se as u};
