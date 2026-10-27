import{r as c,R as k}from"./index-D_uOysDD.js";import{j as H,O as Y,am as J,aj as L,ac as S,a7 as y,W as b,an as ee,D as X,ao as te,$ as Q,H as O,ap as re,k as U,g as Z,V as R,aq as ie,c as ae,ar as se,b as $,K as ne,T as le,f as oe,q as ue,x as de,u as ce,G as he,B as fe,M as K}from"./Gltf-Pam6voya.js";class pe{constructor(){this.isPass=!0,this.enabled=!0,this.needsSwap=!0,this.clear=!1,this.renderToScreen=!1}setSize(){}render(){console.error("THREE.Pass: .render() must be implemented in derived pass.")}dispose(){}}const me=new Y(-1,1,1,-1,0,1);class ve extends J{constructor(){super(),this.setAttribute("position",new L([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute("uv",new L([0,2,0,0,2,0],2))}}const ge=new ve;class q{constructor(e){this._mesh=new H(ge,e)}dispose(){this._mesh.geometry.dispose()}render(e){e.render(this._mesh,me)}get material(){return this._mesh.material}set material(e){this._mesh.material=e}}const xe={uniforms:{tDiffuse:{value:null},opacity:{value:1}},vertexShader:`

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


		}`};class _ extends pe{constructor(e,t,r,i){super(),this.renderScene=t,this.renderCamera=r,this.selectedObjects=i!==void 0?i:[],this.visibleEdgeColor=new S(1,1,1),this.hiddenEdgeColor=new S(.1,.04,.02),this.edgeGlow=0,this.usePatternTexture=!1,this.patternTexture=null,this.edgeThickness=1,this.edgeStrength=3,this.downSampleRatio=2,this.pulsePeriod=0,this._visibilityCache=new Map,this._selectionCache=new Set,this.resolution=e!==void 0?new y(e.x,e.y):new y(256,256);const a=Math.round(this.resolution.x/this.downSampleRatio),l=Math.round(this.resolution.y/this.downSampleRatio);this.renderTargetMaskBuffer=new b(this.resolution.x,this.resolution.y),this.renderTargetMaskBuffer.texture.name="OutlinePass.mask",this.renderTargetMaskBuffer.texture.generateMipmaps=!1,this.depthMaterial=new ee,this.depthMaterial.side=X,this.depthMaterial.depthPacking=te,this.depthMaterial.blending=Q,this.prepareMaskMaterial=this._getPrepareMaskMaterial(),this.prepareMaskMaterial.side=X,this.prepareMaskMaterial.fragmentShader=p(this.prepareMaskMaterial.fragmentShader,this.renderCamera),this.renderTargetDepthBuffer=new b(this.resolution.x,this.resolution.y,{type:O}),this.renderTargetDepthBuffer.texture.name="OutlinePass.depth",this.renderTargetDepthBuffer.texture.generateMipmaps=!1,this.renderTargetMaskDownSampleBuffer=new b(a,l,{type:O}),this.renderTargetMaskDownSampleBuffer.texture.name="OutlinePass.depthDownSample",this.renderTargetMaskDownSampleBuffer.texture.generateMipmaps=!1,this.renderTargetBlurBuffer1=new b(a,l,{type:O}),this.renderTargetBlurBuffer1.texture.name="OutlinePass.blur1",this.renderTargetBlurBuffer1.texture.generateMipmaps=!1,this.renderTargetBlurBuffer2=new b(Math.round(a/2),Math.round(l/2),{type:O}),this.renderTargetBlurBuffer2.texture.name="OutlinePass.blur2",this.renderTargetBlurBuffer2.texture.generateMipmaps=!1,this.edgeDetectionMaterial=this._getEdgeDetectionMaterial(),this.renderTargetEdgeBuffer1=new b(a,l,{type:O}),this.renderTargetEdgeBuffer1.texture.name="OutlinePass.edge1",this.renderTargetEdgeBuffer1.texture.generateMipmaps=!1,this.renderTargetEdgeBuffer2=new b(Math.round(a/2),Math.round(l/2),{type:O}),this.renderTargetEdgeBuffer2.texture.name="OutlinePass.edge2",this.renderTargetEdgeBuffer2.texture.generateMipmaps=!1;const u=4,d=4;this.separableBlurMaterial1=this._getSeparableBlurMaterial(u),this.separableBlurMaterial1.uniforms.texSize.value.set(a,l),this.separableBlurMaterial1.uniforms.kernelRadius.value=1,this.separableBlurMaterial2=this._getSeparableBlurMaterial(d),this.separableBlurMaterial2.uniforms.texSize.value.set(Math.round(a/2),Math.round(l/2)),this.separableBlurMaterial2.uniforms.kernelRadius.value=d,this.overlayMaterial=this._getOverlayMaterial();const n=xe;this.copyUniforms=re.clone(n.uniforms),this.materialCopy=new U({uniforms:this.copyUniforms,vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,blending:Q,depthTest:!1,depthWrite:!1}),this.enabled=!0,this.needsSwap=!1,this._oldClearColor=new S,this.oldClearAlpha=1,this._fsQuad=new q(null),this.tempPulseColor1=new S,this.tempPulseColor2=new S,this.textureMatrix=new Z;function p(h,v){const g=v.isPerspectiveCamera?"perspective":"orthographic";return h.replace(/DEPTH_TO_VIEW_Z/g,g+"DepthToViewZ")}}dispose(){this.renderTargetMaskBuffer.dispose(),this.renderTargetDepthBuffer.dispose(),this.renderTargetMaskDownSampleBuffer.dispose(),this.renderTargetBlurBuffer1.dispose(),this.renderTargetBlurBuffer2.dispose(),this.renderTargetEdgeBuffer1.dispose(),this.renderTargetEdgeBuffer2.dispose(),this.depthMaterial.dispose(),this.prepareMaskMaterial.dispose(),this.edgeDetectionMaterial.dispose(),this.separableBlurMaterial1.dispose(),this.separableBlurMaterial2.dispose(),this.overlayMaterial.dispose(),this.materialCopy.dispose(),this._fsQuad.dispose()}setSize(e,t){this.renderTargetMaskBuffer.setSize(e,t),this.renderTargetDepthBuffer.setSize(e,t);let r=Math.round(e/this.downSampleRatio),i=Math.round(t/this.downSampleRatio);this.renderTargetMaskDownSampleBuffer.setSize(r,i),this.renderTargetBlurBuffer1.setSize(r,i),this.renderTargetEdgeBuffer1.setSize(r,i),this.separableBlurMaterial1.uniforms.texSize.value.set(r,i),r=Math.round(r/2),i=Math.round(i/2),this.renderTargetBlurBuffer2.setSize(r,i),this.renderTargetEdgeBuffer2.setSize(r,i),this.separableBlurMaterial2.uniforms.texSize.value.set(r,i)}render(e,t,r,i,a){if(this.selectedObjects.length>0){e.getClearColor(this._oldClearColor),this.oldClearAlpha=e.getClearAlpha();const l=e.autoClear;e.autoClear=!1,a&&e.state.buffers.stencil.setTest(!1),e.setClearColor(16777215,1),this._updateSelectionCache(),this._changeVisibilityOfSelectedObjects(!1);const u=this.renderScene.background,d=this.renderScene.overrideMaterial;if(this.renderScene.background=null,this.renderScene.overrideMaterial=this.depthMaterial,e.setRenderTarget(this.renderTargetDepthBuffer),e.clear(),e.render(this.renderScene,this.renderCamera),this._changeVisibilityOfSelectedObjects(!0),this._visibilityCache.clear(),this._updateTextureMatrix(),this._changeVisibilityOfNonSelectedObjects(!1),this.renderScene.overrideMaterial=this.prepareMaskMaterial,this.prepareMaskMaterial.uniforms.cameraNearFar.value.set(this.renderCamera.near,this.renderCamera.far),this.prepareMaskMaterial.uniforms.depthTexture.value=this.renderTargetDepthBuffer.texture,this.prepareMaskMaterial.uniforms.textureMatrix.value=this.textureMatrix,e.setRenderTarget(this.renderTargetMaskBuffer),e.clear(),e.render(this.renderScene,this.renderCamera),this._changeVisibilityOfNonSelectedObjects(!0),this._visibilityCache.clear(),this._selectionCache.clear(),this.renderScene.background=u,this.renderScene.overrideMaterial=d,this._fsQuad.material=this.materialCopy,this.copyUniforms.tDiffuse.value=this.renderTargetMaskBuffer.texture,e.setRenderTarget(this.renderTargetMaskDownSampleBuffer),e.clear(),this._fsQuad.render(e),this.tempPulseColor1.copy(this.visibleEdgeColor),this.tempPulseColor2.copy(this.hiddenEdgeColor),this.pulsePeriod>0){const n=.625+Math.cos(performance.now()*.01/this.pulsePeriod)*.75/2;this.tempPulseColor1.multiplyScalar(n),this.tempPulseColor2.multiplyScalar(n)}this._fsQuad.material=this.edgeDetectionMaterial,this.edgeDetectionMaterial.uniforms.maskTexture.value=this.renderTargetMaskDownSampleBuffer.texture,this.edgeDetectionMaterial.uniforms.texSize.value.set(this.renderTargetMaskDownSampleBuffer.width,this.renderTargetMaskDownSampleBuffer.height),this.edgeDetectionMaterial.uniforms.visibleEdgeColor.value=this.tempPulseColor1,this.edgeDetectionMaterial.uniforms.hiddenEdgeColor.value=this.tempPulseColor2,e.setRenderTarget(this.renderTargetEdgeBuffer1),e.clear(),this._fsQuad.render(e),this._fsQuad.material=this.separableBlurMaterial1,this.separableBlurMaterial1.uniforms.colorTexture.value=this.renderTargetEdgeBuffer1.texture,this.separableBlurMaterial1.uniforms.direction.value=_.BlurDirectionX,this.separableBlurMaterial1.uniforms.kernelRadius.value=this.edgeThickness,e.setRenderTarget(this.renderTargetBlurBuffer1),e.clear(),this._fsQuad.render(e),this.separableBlurMaterial1.uniforms.colorTexture.value=this.renderTargetBlurBuffer1.texture,this.separableBlurMaterial1.uniforms.direction.value=_.BlurDirectionY,e.setRenderTarget(this.renderTargetEdgeBuffer1),e.clear(),this._fsQuad.render(e),this._fsQuad.material=this.separableBlurMaterial2,this.separableBlurMaterial2.uniforms.colorTexture.value=this.renderTargetEdgeBuffer1.texture,this.separableBlurMaterial2.uniforms.direction.value=_.BlurDirectionX,e.setRenderTarget(this.renderTargetBlurBuffer2),e.clear(),this._fsQuad.render(e),this.separableBlurMaterial2.uniforms.colorTexture.value=this.renderTargetBlurBuffer2.texture,this.separableBlurMaterial2.uniforms.direction.value=_.BlurDirectionY,e.setRenderTarget(this.renderTargetEdgeBuffer2),e.clear(),this._fsQuad.render(e),this._fsQuad.material=this.overlayMaterial,this.overlayMaterial.uniforms.maskTexture.value=this.renderTargetMaskBuffer.texture,this.overlayMaterial.uniforms.edgeTexture1.value=this.renderTargetEdgeBuffer1.texture,this.overlayMaterial.uniforms.edgeTexture2.value=this.renderTargetEdgeBuffer2.texture,this.overlayMaterial.uniforms.patternTexture.value=this.patternTexture,this.overlayMaterial.uniforms.edgeStrength.value=this.edgeStrength,this.overlayMaterial.uniforms.edgeGlow.value=this.edgeGlow,this.overlayMaterial.uniforms.usePatternTexture.value=this.usePatternTexture,a&&e.state.buffers.stencil.setTest(!0),e.setRenderTarget(r),this._fsQuad.render(e),e.setClearColor(this._oldClearColor,this.oldClearAlpha),e.autoClear=l}this.renderToScreen&&(this._fsQuad.material=this.materialCopy,this.copyUniforms.tDiffuse.value=r.texture,e.setRenderTarget(null),this._fsQuad.render(e))}_updateSelectionCache(){const e=this._selectionCache;function t(r){r.isMesh&&e.add(r)}e.clear();for(let r=0;r<this.selectedObjects.length;r++)this.selectedObjects[r].traverse(t)}_changeVisibilityOfSelectedObjects(e){const t=this._visibilityCache;for(const r of this._selectionCache)e===!0?r.visible=t.get(r):(t.set(r,r.visible),r.visible=e)}_changeVisibilityOfNonSelectedObjects(e){const t=this._visibilityCache,r=this._selectionCache;function i(a){if(a.isPoints||a.isLine||a.isLine2)e===!0?a.visible=t.get(a):(t.set(a,a.visible),a.visible=e);else if((a.isMesh||a.isSprite)&&!r.has(a)){const l=a.visible;(e===!1||t.get(a)===!0)&&(a.visible=e),t.set(a,l)}}this.renderScene.traverse(i)}_updateTextureMatrix(){this.textureMatrix.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),this.textureMatrix.multiply(this.renderCamera.projectionMatrix),this.textureMatrix.multiply(this.renderCamera.matrixWorldInverse)}_getPrepareMaskMaterial(){return new U({uniforms:{depthTexture:{value:null},cameraNearFar:{value:new y(.5,.5)},textureMatrix:{value:null}},vertexShader:`#include <batching_pars_vertex>
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

				}`})}_getEdgeDetectionMaterial(){return new U({uniforms:{maskTexture:{value:null},texSize:{value:new y(.5,.5)},visibleEdgeColor:{value:new R(1,1,1)},hiddenEdgeColor:{value:new R(1,1,1)}},vertexShader:`varying vec2 vUv;

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
				}`})}_getSeparableBlurMaterial(e){return new U({defines:{MAX_RADIUS:e},uniforms:{colorTexture:{value:null},texSize:{value:new y(.5,.5)},direction:{value:new y(.5,.5)},kernelRadius:{value:1}},vertexShader:`varying vec2 vUv;

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
				}`})}_getOverlayMaterial(){return new U({uniforms:{maskTexture:{value:null},edgeTexture1:{value:null},edgeTexture2:{value:null},patternTexture:{value:null},edgeStrength:{value:1},edgeGlow:{value:1},usePatternTexture:{value:0}},vertexShader:`varying vec2 vUv;

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
				}`,blending:ie,depthTest:!1,depthWrite:!1,transparent:!0})}}_.BlurDirectionX=new y(1,0);_.BlurDirectionY=new y(0,1);function Me(s,e){s.updateWorldMatrix(!0,!1);const t=s.matrixWorldInverse.elements,r=-(t[6]*.8+t[14]),i=e.height*s.projectionMatrix.elements[5]/2/(s.isOrthographicCamera?1:Math.max(.01,r));return Math.max(.01,i/100)}const I=c.createContext(null);class Te extends _{constructor(e,t,r,i){super(e,t,r,[]),this.ignoredObjects=i,this.ignoredVisibility=new Map,this.hiddenEdgeColor.set(0),this.visibleEdgeColor.set(16777215),this.usePatternTexture=!1,this.renderTargetDepthBuffer.texture.type=ne,this.overlayMaterial.blending=Q,this.separableBlurMaterial2.uniforms.kernelRadius.value=3.5}render(e,t,r,i,a){for(const d of this.ignoredObjects)this.ignoredVisibility.set(d,d.visible),d.visible=!1;const l=e.shadowMap.autoUpdate,u=e.shadowMap.needsUpdate;e.shadowMap.autoUpdate=!1,e.shadowMap.needsUpdate=!1;try{super.render(e,t,r,i,a)}finally{e.shadowMap.autoUpdate=l,e.shadowMap.needsUpdate=u;for(const[d,n]of this.ignoredVisibility)d.visible=n;this.ignoredVisibility.clear()}}}function Ce(s,e,t){const r=c.useContext(I),i=c.useMemo(()=>({object:s,objective:e,highlighted:t}),[s]);c.useLayoutEffect(()=>{i.objective=e,i.highlighted=t},[i,e,t]),c.useLayoutEffect(()=>{if(r)return r.models.add(i),()=>r.models.delete(i)},[r,i])}function De(){const s=c.useContext(I),e=c.useRef(null);return c.useCallback(t=>{e.current&&s?.ignored.delete(e.current),e.current=t,t&&s?.ignored.add(t)},[s])}function ye({registry:s,reducedMotion:e}){const{gl:t,scene:r,camera:i}=ae(),a=c.useRef(null);return c.useEffect(()=>{const l=new Te(new y(1,1),r,i,s.ignored),u=new b(1,1,{type:O,depthBuffer:!1});u.texture.name="KitchenTaskOutline.overlay";const d=new U({uniforms:{edgeTexture:{value:u.texture},outlineColor:{value:new S("#ffc52a")},outlineOpacity:{value:.9}},vertexShader:`varying vec2 vUv;
        void main() {vUv = uv;gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);}`,fragmentShader:`varying vec2 vUv;uniform sampler2D edgeTexture;
        uniform vec3 outlineColor;uniform float outlineOpacity;
        void main() {
          vec3 edge = texture2D(edgeTexture, vUv).rgb;
          float coverage = clamp(max(max(edge.r, edge.g), edge.b), 0.0, 1.0);
          gl_FragColor = vec4(outlineColor, coverage * outlineOpacity);
          #include <colorspace_fragment>
        }`,blending:se,transparent:!0,depthTest:!1,depthWrite:!1,toneMapped:!1}),n=new q(d);return a.current={outline:l,target:u,material:d,quad:n,clearColor:new S,width:0,height:0,pixelRatio:0},()=>{a.current=null,l.dispose(),u.dispose(),d.dispose(),n.dispose()}},[t,r,i,s]),$(({clock:l,size:u},d)=>{const n=a.current;if(!n){t.render(r,i);return}const{outline:p,target:h,quad:v}=n,g=t.getPixelRatio();if(n.width!==u.width||n.height!==u.height||n.pixelRatio!==g){const M=Math.max(1,Math.round(u.width*g)),o=Math.max(1,Math.round(u.height*g));h.setSize(M,o),p.setSize(M,o),n.width=u.width,n.height=u.height,n.pixelRatio=g}const D=p.selectedObjects;D.length=0;let x=!1;for(const M of s.models)!M.objective&&!M.highlighted||!M.object.visible||(D.push(M.object),x||=M.highlighted);if(t.render(r,i),!D.length)return;const P=e?.5:.5+Math.sin(l.elapsedTime*2.6)*.5,A=Math.max(.8,Me(i,u));p.edgeThickness=Math.min(4,(x?2.1:1.7+P*.5)*A*g),p.edgeStrength=x?6.3:4.1+P*1.7,p.edgeGlow=1.05+P*1.05,n.material.uniforms.outlineOpacity.value=x?1:.82+P*.16;const j=t.autoClear,z=t.getClearAlpha();t.getClearColor(n.clearColor);try{t.setRenderTarget(h),t.setClearColor(0,0),t.clear(),t.setClearColor(n.clearColor,z),p.render(t,null,h,d,!1),t.setRenderTarget(null),t.autoClear=!1,v.render(t)}finally{t.setRenderTarget(null),t.setClearColor(n.clearColor,z),t.autoClear=j}},1),null}function Pe({children:s,reducedMotion:e}){const t=c.useMemo(()=>({models:new Set,ignored:new Set}),[]);return k.createElement(I.Provider,{value:t},s,k.createElement(ye,{registry:t,reducedMotion:e}))}function Se(s){const e=new le().load("/images/scene/chalk-cutlery.svg");e.colorSpace=oe;const t=new ue(.32,.38),r=new de({map:e,transparent:!0,opacity:.9,depthTest:!0,depthWrite:!1,alphaTest:.01,toneMapped:!1,polygonOffset:!0,polygonOffsetFactor:-1,polygonOffsetUnits:-1}),i=new H(t,r);i.name="chalk-spoon-and-fork";const a=new R(.95448,.29827,0).normalize(),l=new R(0,0,-1),u=new R(-a.y,a.x,0);return i.quaternion.setFromRotationMatrix(new Z().makeBasis(l,u,a)),i.position.set(-.0139,.12,-.04).addScaledVector(a,.003),i.raycast=()=>{},s.add(i),()=>{s.remove(i),t.dispose(),r.dispose(),e.dispose()}}function we(s,e){const t=s.onBeforeCompile;s.onBeforeCompile=(r,i)=>{t.call(s,r,i),r.uniforms.kitchenScreenAmount=e,r.uniforms.kitchenScreenTint={value:new S("#bce8d2")},r.vertexShader=`varying vec3 vKitchenScreenPosition;
${r.vertexShader}`.replace("#include <begin_vertex>",`#include <begin_vertex>
vKitchenScreenPosition = position;`),r.fragmentShader=`varying vec3 vKitchenScreenPosition;
uniform float kitchenScreenAmount;
uniform vec3 kitchenScreenTint;
${r.fragmentShader}`.replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>
        vec3 screenPosition = vKitchenScreenPosition;
        float glassArea = smoothstep(.005, .022, screenPosition.x) * (1.0 - smoothstep(.065, .085, screenPosition.x));
        glassArea *= smoothstep(.285, .315, screenPosition.y) * (1.0 - smoothstep(.79, .82, screenPosition.y));
        glassArea *= 1.0 - smoothstep(.395, .425, abs(screenPosition.z));
        float glassColor = 1.0 - smoothstep(.23, .36, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)));
        glassColor *= smoothstep(.005, .035, diffuseColor.g - diffuseColor.r);
        totalEmissiveRadiance += kitchenScreenTint * kitchenScreenAmount * glassArea * glassColor * .9;
      `)},s.customProgramCacheKey=()=>"kitchen-computer-screen-v1"}const N=new S("#ffe066");class Be extends k.Component{state={failed:!1};static getDerivedStateFromError(){return{failed:!0}}componentDidCatch(e){this.props.onError?.(e)}render(){return this.state.failed?null:this.props.children}}function be({url:s,dimensions:e=[],position:t,rotationY:r,uniform:i,objective:a,highlighted:l,interacting:u,reducedMotion:d,required:n=!1}){const{scene:p}=ce(s,"/draco/"),h=c.useRef(0),v=c.useRef({value:0}).current,{object:g,size:D,materials:x,disposeDetails:P}=c.useMemo(()=>{const o=new he,m=p.clone(!0),T=new Map,w=(f,F=!1)=>{if(!f)return f;const V=F?`${f.uuid}:screen`:f;if(!T.has(V)){const G=f.clone();F&&we(G,v),T.set(V,{material:G,emissive:G.emissive?.clone(),emissiveMap:G.emissiveMap,intensity:G.emissiveIntensity??1})}return T.get(V).material};m.traverse(f=>{if(f.isMesh){f.castShadow=!0,f.receiveShadow=!0;const F=s.endsWith("/discovery-computer-v2.glb")&&/^Monitor[_ ]and[_ ]stand(?:_\d+)?$/.test(f.name);f.material=Array.isArray(f.material)?f.material.map(V=>w(V,F)):w(f.material,F)}});const E=s.endsWith("/discovery-bot-v3.glb")?Se(m):()=>{};o.add(m),o.rotation.y=r,o.updateMatrixWorld(!0);const B=new fe().setFromObject(o),C=B.getSize(new R),W=B.getCenter(new R);if(n&&(B.isEmpty()||!Number.isFinite(C.x+C.y+C.z)||Math.max(C.x,C.y,C.z)<=0))throw new Error(`The object model contains no visible geometry: ${s}`);return B.isEmpty()||o.position.set(-W.x,-B.min.y,-W.z),{object:o,size:C,materials:[...T.values()],disposeDetails:E}},[p,r,n,s,v]);Ce(g,a,l),c.useEffect(()=>()=>{x.forEach(({material:o})=>o.dispose()),P()},[x,P]),c.useEffect(()=>{for(const{material:o,emissive:m,emissiveMap:T}of x){if(!m)continue;const w=l||a?T||o.map:T;o.emissiveMap!==w&&(o.emissiveMap=w,o.needsUpdate=!0)}},[l,a,x]),$(({clock:o},m)=>{v.value=K.damp(v.value,l||u?1:0,12,Math.min(m,.05)),v.value<.001&&(v.value=0);const T=d?.5:.5+Math.sin(o.elapsedTime*2.6)*.5,w=l?.34+T*.14:a?.22+T*.24:0;h.current=d?w:K.damp(h.current,w,9,Math.min(m,.05)),h.current<.001&&(h.current=0);for(const{material:E,emissive:B,intensity:C}of x)B&&(E.emissive.copy(B),E.emissive.r+=N.r*h.current,E.emissive.g+=N.g*h.current,E.emissive.b+=N.b*h.current,E.emissiveIntensity=C+h.current*.25)});const A=(o,m)=>Number.isFinite(o)&&o>0&&m>1e-6?o/m:null,j=[A(e[0],D.x),A(e[1],D.y),A(e[2],D.z)],z=Math.min(...j.filter(o=>o!==null),1/0),M=i?Number.isFinite(z)?z:1:j.map(o=>o??1);return k.createElement("group",{position:t,scale:M},k.createElement("primitive",{object:g,dispose:null}))}function Ee({entry:s,dimensions:e,position:t=[0,0,0],rotationY:r=-Math.PI/2,uniform:i=!0,objective:a=!1,highlighted:l=!1,interacting:u=!1,reducedMotion:d=!1,onError:n}){return s?.url?k.createElement(Be,{key:s.url,onError:n},k.createElement(c.Suspense,{fallback:null},k.createElement(be,{url:s.url,dimensions:e,position:t,rotationY:r,uniform:i,objective:a,highlighted:l,interacting:u,reducedMotion:d,required:!!n}))):null}export{Ee as R,Pe as T,Ce as a,Me as g,De as u};
