// A project-scoped UX compatibility renderer, not the openvela GUI runtime.
export function mountPage(host, definition, tree, css, onChange, onExit) {
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { display:block; width:480px; height:554px; font-family:"Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",sans-serif; }
    * { box-sizing:border-box; flex-shrink:0; }
    div,list,list-item { display:flex; flex-direction:column; position:relative; }
    text { display:block; white-space:nowrap; overflow:hidden; line-height:1.2; }
    input { appearance:none; border:0; padding:0; font-family:inherit; cursor:pointer; }
    list { overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; }
    [hidden] { display:none !important; }
    input:focus-visible { outline:3px solid #2563eb; outline-offset:-3px; }
    .viewport { width:480px; height:554px; overflow:hidden; user-select:none; touch-action:pan-y; }
    ${css}
  `;
  const viewport = document.createElement('div'); viewport.className = 'viewport';
  shadow.append(style, viewport);
  const cache = new WeakMap(); let queued = false, destroyed = false, ready = false;
  const schedule = () => { if (!queued && !destroyed && ready) { queued = true; requestAnimationFrame(render); } };
  const reactive = value => {
    if (!value || typeof value !== 'object') return value;
    if (cache.has(value)) return cache.get(value);
    const proxy = new Proxy(value, {
      get(target, key) { return reactive(Reflect.get(target, key)); },
      set(target, key, next) { const old = target[key]; Reflect.set(target, key, next); if (old !== next) schedule(); return true; },
    });
    cache.set(value, proxy); return proxy;
  };
  const vm = reactive({ ...definition.private, ...definition.public, $app: { exit: onExit } });
  for (const [name, method] of Object.entries(definition)) if (typeof method === 'function') vm[name] = method.bind(vm);
  let activePointer = null;
  function touchEvent(event, ending = false) {
    const rect = viewport.getBoundingClientRect();
    const point = { clientX:(event.clientX-rect.left)*480/rect.width, clientY:(event.clientY-rect.top)*554/rect.height, identifier:event.pointerId ?? 1 };
    return { touches:ending ? [] : [point], changedTouches:[point] };
  }
  function mount(node, parent, scope) {
    const marker = document.createComment('ux'); parent.append(marker);
    let element, children = [], rows = [], textNode, previousAttrs = {};
    const remove = () => { children.forEach(child => child.dispose()); children=[]; element?.remove(); element=null; textNode?.remove(); textNode=null; previousAttrs={}; };
    const update = () => {
      if (node.each) {
        const values = node.each(vm, scope) || [];
        while (rows.length > values.length) rows.pop().dispose();
        for (let i=0; i<values.length; i++) {
          if (!rows[i]) {
            const rowScope = { ...scope, $item:values[i], $idx:i };
            rows[i] = { ...mount({ ...node, each:null }, parent, rowScope), scope:rowScope };
            parent.insertBefore(rows[i].marker, marker);
          }
          rows[i].scope.$item = values[i]; rows[i].scope.$idx=i; rows[i].update();
        }
        return;
      }
      if (node.if && !node.if(vm, scope)) { remove(); return; }
      if (node.text) {
        if (!textNode) { textNode = document.createTextNode(''); parent.insertBefore(textNode, marker); }
        const value = node.text(vm, scope); if (textNode.data !== value) textNode.data = value; return;
      }
      if (!element) {
        element = document.createElement(node.tag);
        if (node.tag === 'input') element.type = 'button';
        for (const [name, handler] of Object.entries(node.events)) {
          const eventName = {touchstart:'pointerdown',touchmove:'pointermove',touchend:'pointerup'}[name];
          element.addEventListener(eventName, event => {
            if (event.pointerId !== activePointer || (name === 'touchmove' && !event.buttons && event.pointerType === 'mouse')) return;
            handler(vm, scope, touchEvent(event, name === 'touchend'));
          });
        }
        if (node.tag === 'input') element.addEventListener('click', event => {
          if (event.detail !== 0) return; // Pointer actions already went through the UX touch handlers.
          const rect = element.getBoundingClientRect();
          const point = {clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2,pointerId:-1};
          node.events.touchstart?.(vm,scope,touchEvent(point));
          node.events.touchend?.(vm,scope,touchEvent(point,true));
        });
        parent.insertBefore(element, marker);
        children = node.children.map(child => mount(child, element, scope));
      }
      element.hidden = node.show ? !node.show(vm, scope) : false;
      for (const [name, evaluate] of Object.entries(node.attrs)) {
        if (name === 'type') continue;
        const value = evaluate(vm, scope);
        if (previousAttrs[name] !== value) {
          if (name === 'value') element.value = value;
          else element.setAttribute(name, value);
          previousAttrs[name] = value;
        }
      }
      children.forEach(child => child.update());
    };
    return { marker, update, dispose() { rows.forEach(row=>row.dispose()); remove(); marker.remove(); } };
  }
  viewport.addEventListener('pointerdown', event => {
    if (activePointer !== null) { cancelTouch(); return; }
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    activePointer=event.pointerId;
  }, true);
  viewport.addEventListener('pointerdown', event => {
    if (event.pointerId === activePointer) viewport.setPointerCapture(event.pointerId);
  });
  // Capture redirects subsequent events to the viewport, so forward them to the
  // original page root. One finish call is enough; the app cancels duplicates.
  viewport.addEventListener('pointermove', event => {
    if (event.target === viewport && event.pointerId === activePointer) vm.moveTouchGesture(touchEvent(event));
  });
  viewport.addEventListener('pointerup', event => {
    if (event.pointerId !== activePointer) return;
    if (event.target === viewport) vm.finishTouchGesture(touchEvent(event,true));
    activePointer=null;
  });
  const cancelTouch = () => { activePointer=null; vm.finishTouchGesture({touches:[],changedTouches:[]}); };
  viewport.addEventListener('pointercancel', cancelTouch);
  viewport.addEventListener('lostpointercapture', () => { if (activePointer !== null) cancelTouch(); });
  window.addEventListener('blur', cancelTouch);
  const nodes = tree.map(node => mount(node, viewport, {}));
  function render() { queued=false; if (destroyed) return; nodes.forEach(node=>node.update()); onChange(vm); }
  vm.onReady?.(); ready=true; vm.onShow?.(); render();
  return {
    vm, show:()=>vm.onShow?.(), hide:()=>{cancelTouch(); vm.onHide?.();},
    destroy() { destroyed=true; vm.onDestroy?.(); nodes.forEach(node=>node.dispose()); window.removeEventListener('blur',cancelTouch); },
  };
}
