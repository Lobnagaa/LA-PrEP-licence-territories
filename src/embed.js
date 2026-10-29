/* Embedding: when the page runs inside an iframe (e.g. a LAPaL tab), it tells the
 * parent page its height, so the iframe can be sized to fit with no inner scrollbar.
 *
 * Message sent to the parent on load and whenever the height changes:
 *   { type: 'lapal-prep-licences:height', height: <pixels> }
 * Only the height is sent, so any parent may receive it ('*'). The parent should
 * check event.origin before using it; see "Embedding in LAPaL" in DEVELOPER_NOTES.md.
 */
(function (root) {
  'use strict';
  if (root.parent === root) return;   // not in an iframe

  var MESSAGE = 'lapal-prep-licences:height';
  var last = 0;
  function send() {
    // The page wrapper's own height, not the document's, which never shrinks below the iframe.
    var page = document.querySelector('.lapal-page');
    var h = Math.ceil((page || document.body).getBoundingClientRect().height);
    if (h && h !== last) { last = h; root.parent.postMessage({ type: MESSAGE, height: h }, '*'); }
  }
  function start() {
    send();
    if (root.ResizeObserver) new ResizeObserver(send).observe(document.querySelector('.lapal-page') || document.body);
    else root.setInterval(send, 500);
    root.addEventListener('load', send);   // fonts and images can change the height after start
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
