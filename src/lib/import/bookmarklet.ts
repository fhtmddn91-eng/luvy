/**
 * 1688 상세페이지에서 상품 데이터를 추출해 클립보드로 복사하는 북마클릿.
 *
 * 왜 서버에서 직접 크롤링하지 않는가:
 *   1688 상세 HTML은 알리바바 봇 차단(X5Sec)이 걸려 서버 요청이 캡차로 튕긴다.
 *   반면 이 스크립트는 사용자의 실제 로그인 브라우저에서 돌기 때문에 차단되지 않는다.
 *   추출된 이미지 URL은 CDN(alicdn)에 있어 서버에서 그대로 내려받을 수 있다.
 *
 * 왜 클립보드인가:
 *   LUVY 세션 쿠키가 SameSite=Lax 이므로 1688 도메인에서 보내는 요청에는
 *   쿠키가 실리지 않는다. 쿠키를 None 으로 완화하면 사이트 전체의 CSRF 방어가
 *   약해지므로, 추출 결과를 클립보드로 옮겨 관리자가 붙여넣는 방식을 택했다.
 *
 * 추출 전략 — 구조화 데이터 우선, DOM 은 폴백:
 *   현재 1688 상세페이지는 window.context 에 상품 전체 데이터를 담아 렌더링한다
 *   (상품명 subject, 대표이미지 offerImgList, SKU skuModel, 가격 offerPriceModel,
 *   속성 featureAttributes, 상세설명 detailUrl). DOM 셀렉터로 긁으면 레이아웃이
 *   바뀔 때마다 깨지고, 전체 이미지 폴백은 플랫폼 로고(타오바오·JD 등)·아이콘까지
 *   집어오는 사고가 났다(실제 발생). 구조화 데이터를 먼저 읽고, 없을 때만 DOM 을
 *   뒤지되 로고·아이콘 영역은 제외한다.
 *
 *   상세이미지는 페이지에 lazy-load 로 일부만 올라오므로 DOM 만 보면 중간이
 *   빠진다(실제 발생). detailUrl 이 가리키는 CDN 스크립트(offer_details JSONP)를
 *   불러오면 스크롤 여부와 무관하게 상세이미지 전체가 순서대로 나온다.
 */
export const BOOKMARKLET_SOURCE = `(function(){
  try {
    var host = location.hostname;
    if (host.indexOf('1688.com') === -1) {
      alert('1688 상품 상세페이지에서 실행해주세요.');
      return;
    }
    var offer = (location.href.match(/offer\\/(\\d{6,})/) || location.href.match(/[?&]offerId=(\\d{6,})/) || [])[1];
    if (!offer) { alert('상품 상세페이지가 아닙니다. (offerId를 찾을 수 없음)'); return; }

    var ALI = /(^|\\.)alicdn\\.com$/i;
    function abs(u){
      if(!u) return null;
      u = String(u).trim();
      if(u.indexOf('//') === 0) u = 'https:' + u;
      if(u.indexOf('http') !== 0) return null;
      try { var p = new URL(u); return ALI.test(p.hostname) ? p.origin + p.pathname : null; } catch(e){ return null; }
    }
    function uniq(a){ var s={},o=[]; a.forEach(function(x){ if(x && !s[x]){s[x]=1;o.push(x);} }); return o; }
    // 플랫폼 로고·아이콘 걸러내기: URL 에 -tps-가로-세로 크기가 박혀 있다
    function junkUrl(u){
      if (/\\.svg$/i.test(u)) return true;
      var m = u.match(/-tps-(\\d+)-(\\d+)\\./);
      return !!(m && (parseInt(m[1],10) < 200 || parseInt(m[2],10) < 200));
    }
    // 상품 이미지가 아닌 UI 영역(상점 네비·대리판매 로고·사이드바·추천·장바구니)
    var JUNK_AREA = '[class*="consign"],[class*="shop-navigation"],[class*="side-bar"],[class*="recommend"],[class*="cart"],[class*="widgets"],[class*="services"],[class*="shipping"]';
    // 지연 로딩 이미지는 src 가 비어 있고 data-* 에 실제 주소가 들어 있다
    function srcOf(img){
      return abs(img.getAttribute('data-lazyload-src')) || abs(img.getAttribute('data-ks-lazyload'))
          || abs(img.getAttribute('data-src')) || abs(img.getAttribute('src'))
          || abs(img.getAttribute('data-original'));
    }
    function collect(sel){
      var out = [];
      document.querySelectorAll(sel).forEach(function(el){
        var imgs = el.tagName === 'IMG' ? [el] : el.querySelectorAll('img');
        Array.prototype.forEach.call(imgs, function(i){
          if (i.closest && i.closest(JUNK_AREA)) return;
          var s = srcOf(i);
          if (s && !junkUrl(s)) out.push(s);
        });
      });
      return out;
    }

    // ---------- 구조화 데이터 (window.context — 2026 레이아웃) ----------
    var model = null, mods = null, dataJson = null;
    try {
      var r = window.context && window.context.result;
      mods = (r && r.data) || null;
      model = (r && r.global && r.global.globalData && r.global.globalData.model) || null;
      dataJson = (mods && mods.Root && mods.Root.fields && mods.Root.fields.dataJson) || null;
    } catch(e){}
    var od = (model && model.offerDetail) || null;
    var sku = (dataJson && dataJson.skuModel) || null;

    // 상품명. 구조화 데이터의 subject 가 정본. DOM 폴백 시 h1 을 먼저 잡으면
    // 판매사 이름이 상품명으로 들어간다(실제 발생) — 전용 클래스 → 문서 제목
    // (뒤의 "- 阿里巴巴" 꼬리 제거) → h1 순서.
    function pickTitle(){
      var el = document.querySelector('.title-text, .d-title, [class*="offer-title"], [class*="title-first"], [class*="subject"]');
      var t = el ? (el.innerText || '').trim().split('\\n')[0] : '';
      if (!t) t = (document.title || '').replace(/\\s*[-|–—]\\s*(阿里巴巴|1688).*$/, '').trim();
      if (!t) { var h = document.querySelector('h1'); t = h ? (h.innerText || '').trim() : ''; }
      return t;
    }
    var title = (od && od.subject) || pickTitle();

    // 대표이미지: gallery 모듈 → offerDetail.imageList → DOM 셀렉터
    var main = [];
    try {
      var gl = mods.gallery.fields.offerImgList;
      if (gl && gl.length) gl.forEach(function(u){ var s = abs(u); if (s) main.push(s); });
    } catch(e){}
    if (main.length === 0 && od && od.imageList) {
      od.imageList.forEach(function(o){
        var s = abs(o && (o.fullPathImageURI || o.imageURI || o.url || o.imageUrl));
        if (s) main.push(s);
      });
    }
    if (main.length === 0) main = collect('.detail-gallery-turn-wrapper, .od-gallery-preview, .tab-trigger, .od-gallery-turn, .img-list-wrapper, [class*="gallery"]');
    main = uniq(main);

    // 옵션(SKU) 이미지: skuProps → DOM 폴백
    var option = [];
    if (sku && sku.skuProps) {
      sku.skuProps.forEach(function(p){
        (p.value || []).forEach(function(v){ var s = abs(v && v.imageUrl); if (s) option.push(s); });
      });
    }
    if (option.length === 0) option = collect('.expand-view-list, .obj-sku, [class*="sku-item"], [class*="prop-item"]');
    option = uniq(option).filter(function(u){ return main.indexOf(u) === -1; });

    // 가격: 구간가(currentPrices) → SKU 별 단가 최저~최고 → DOM 폴백
    var tiers = [];
    try {
      (model.tradeModel.offerPriceModel.currentPrices || []).forEach(function(t){
        var q = parseInt(t.beginAmount, 10) || 1;
        var pr = parseFloat(t.price);
        if (pr > 0) tiers.push({ minQty: q, price: pr });
      });
    } catch(e){}
    if (tiers.length === 0 && sku && sku.skuInfoMap) {
      var ps = [];
      for (var k in sku.skuInfoMap) { var sp = parseFloat(sku.skuInfoMap[k].price); if (sp > 0) ps.push(sp); }
      if (ps.length) {
        var lo = Math.min.apply(null, ps), hi = Math.max.apply(null, ps);
        tiers.push({ minQty: 1, price: lo });
        if (hi > lo) tiers.push({ minQty: 1, price: hi });
      }
    }
    if (tiers.length === 0) {
      document.querySelectorAll('[class*="price-item"], [class*="price-range"], .price-list li').forEach(function(el){
        var txt = (el.innerText || '').replace(/,/g, '');
        var q = txt.match(/(\\d+)\\s*(?:件|个|개|pcs)?\\s*(?:以上|起|~|이상)?/);
        var p = txt.match(/(?:¥|￥)?\\s*(\\d+(?:\\.\\d+)?)/g);
        if (q && p && p.length) {
          var price = parseFloat(p[p.length - 1].replace(/[^\\d.]/g, ''));
          var minQty = parseInt(q[1], 10);
          if (minQty > 0 && price > 0) tiers.push({ minQty: minQty, price: price });
        }
      });
    }
    if (tiers.length === 0) {
      var prices = [];
      document.querySelectorAll('.price-info, [class*="item-price"], [class*="price-stock"], [class*="price-text"]').forEach(function(el){
        var m = (el.innerText || '').replace(/\\s+/g, '').match(/[¥￥](\\d+(?:\\.\\d+)?)/);
        if (m) { var v = parseFloat(m[1]); if (v > 0 && v < 1000000) prices.push(v); }
      });
      if (prices.length) {
        tiers.push({ minQty: 1, price: Math.min.apply(null, prices) });
        var mx = Math.max.apply(null, prices);
        if (mx > Math.min.apply(null, prices)) tiers.push({ minQty: 1, price: mx });
      }
    }

    // 속성: featureAttributes → ant-descriptions 표 → 구 레이아웃 폴백
    var attrs = [];
    function addAttr(k, v){
      k = (k || '').trim(); v = (v || '').trim();
      if (!k || !v || k.length > 30 || v.length > 150) return;
      for (var i = 0; i < attrs.length; i++) if (attrs[i].label === k) return;
      attrs.push({ label: k, value: v });
    }
    if (od && od.featureAttributes) {
      od.featureAttributes.forEach(function(a){
        addAttr(a && a.name, ((a && (a.decisionValues || a.values)) || []).join(','));
      });
    }
    if (attrs.length === 0) {
      document.querySelectorAll('.ant-descriptions-row').forEach(function(row){
        var cells = row.querySelectorAll('th,td,[class*="item-label"],[class*="item-content"]');
        for (var i = 0; i + 1 < cells.length; i += 2) addAttr(cells[i].innerText, cells[i + 1].innerText);
      });
      document.querySelectorAll('.obj-content .offer-attr-list li, [class*="attribute"] li, .od-pc-attribute-item').forEach(function(li){
        var t = (li.innerText || '').trim();
        var kv = t.split(/[:：]/);
        if (kv.length >= 2) addAttr(kv[0], kv.slice(1).join(':'));
      });
    }

    // 상세이미지 DOM 폴백: lazy-load 로 일부만 올라와 있을 수 있음 → 경고 표시용 플래그
    function domDetail(){
      var d = collect('#mod-detail-description, .desc-lazyload-container, [class*="detail-desc"]');
      if (d.length === 0) {
        // 최후 폴백: 페이지 전체에서 UI 영역·로고 제외, 대표/옵션과 중복 제외
        document.querySelectorAll('img').forEach(function(i){
          if (i.closest && i.closest(JUNK_AREA)) return;
          if (i.naturalWidth > 0 && i.naturalWidth < 200) return;
          var s = srcOf(i);
          if (s && !junkUrl(s) && main.indexOf(s) === -1 && option.indexOf(s) === -1) d.push(s);
        });
      }
      return uniq(d);
    }

    var finished = false;
    function finish(detail, viaJsonp){
      if (finished) return;
      finished = true;
      detail = detail.filter(function(u){ return main.indexOf(u) === -1; });
      var payload = {
        url: location.href.split('?')[0],
        extracted: {
          offerId: offer,
          title: title,
          mainImages: main.slice(0, 12),
          detailImages: detail.slice(0, 60),
          optionImages: option.slice(0, 40),
          tiers: tiers,
          attributes: attrs.slice(0, 40)
        }
      };
      var json = JSON.stringify(payload);
      function done(){
        alert('LUVY 수집 데이터 복사 완료\\n\\n상품번호: ' + offer
          + '\\n대표이미지: ' + payload.extracted.mainImages.length + '장'
          + '\\n상세이미지: ' + payload.extracted.detailImages.length + '장' + (viaJsonp ? '' : ' (일부 누락 가능 — 페이지를 끝까지 스크롤 후 다시 실행하면 보강됩니다)')
          + '\\n옵션이미지: ' + payload.extracted.optionImages.length + '장'
          + '\\n가격구간: ' + tiers.length + '개'
          + '\\n\\nLUVY 어드민 > 상품 수집 화면에 붙여넣기(Ctrl+V) 하세요.');
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(done, function(){ window.prompt('아래 내용을 복사하세요 (Ctrl+C)', json); });
      } else {
        window.prompt('아래 내용을 복사하세요 (Ctrl+C)', json);
      }
    }

    // 상세이미지: detailUrl JSONP(전체·순서 보장) → 실패 시 DOM 폴백
    var detailUrl = od && od.detailUrl;
    if (detailUrl && /^https:\\/\\//.test(detailUrl)) {
      var sc = document.createElement('script');
      sc.src = detailUrl;
      var tm = setTimeout(function(){ finish(domDetail(), false); }, 6000);
      sc.onload = function(){
        clearTimeout(tm);
        var c = (window.offer_details && (window.offer_details.content || (window.offer_details.data && window.offer_details.data.content))) || '';
        var found = (String(c).match(/(?:https?:)?\\/\\/[a-z0-9.-]*alicdn\\.com\\/[^\\s"'<>\\\\)]+/gi) || [])
          .map(abs).filter(function(u){ return u && !junkUrl(u); });
        if (found.length) finish(uniq(found), true); else finish(domDetail(), false);
      };
      sc.onerror = function(){ clearTimeout(tm); finish(domDetail(), false); };
      (document.body || document.documentElement).appendChild(sc);
    } else {
      finish(domDetail(), false);
    }
  } catch (e) {
    alert('추출 실패: ' + (e && e.message ? e.message : e));
  }
})();`;

/**
 * 북마크 주소창에 넣을 javascript: URL — 추출 코드를 직접 박제하지 않고,
 * 클릭할 때마다 서버(/bookmarklet.js)에서 **최신 추출 코드를 내려받아 실행**하는
 * 로더다. 북마크는 등록 시점 코드가 박제되므로, 예전처럼 소스를 통째로 넣으면
 * 추출 로직을 고칠 때마다 운영자가 버튼을 다시 드래그해야 했다(실제로 겪음).
 * 이 방식이면 배포만 하면 등록해 둔 북마크가 항상 최신으로 동작한다.
 * (1688 상세페이지는 CSP 가 없어 외부 스크립트 주입이 허용됨 — 실페이지 확인)
 */
export function bookmarkletHref(): string {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://luvyb2b.com";
  const loader = `(function(){
    var s = document.createElement('script');
    s.src = '${origin}/bookmarklet.js?ts=' + Date.now();
    s.onerror = function(){ alert('LUVY 수집 스크립트를 불러오지 못했습니다.\\n네트워크 연결을 확인한 뒤 다시 눌러주세요.'); };
    (document.body || document.documentElement).appendChild(s);
  })();`;
  return "javascript:" + encodeURIComponent(loader);
}
