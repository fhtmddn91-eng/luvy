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
        Array.prototype.forEach.call(imgs, function(i){ var s = srcOf(i); if(s) out.push(s); });
      });
      return out;
    }
    function uniq(a){ var s={},o=[]; a.forEach(function(x){ if(x && !s[x]){s[x]=1;o.push(x);} }); return o; }

    var main = uniq(collect('.detail-gallery-turn-wrapper, .tab-trigger, .od-gallery-turn, .img-list-wrapper, [class*="gallery"] '));
    var detail = uniq(collect('#mod-detail-description, .desc-lazyload-container, [class*="detail-desc"], [class*="description"]'));
    var option = uniq(collect('.obj-sku, [class*="sku-item"], [class*="prop-item"]'));

    // 셀렉터가 바뀌어도 최소한은 건지도록: 페이지 전체 이미지에서 미분류분 보강
    if (main.length === 0 || detail.length === 0) {
      var all = [];
      document.querySelectorAll('img').forEach(function(i){ var s = srcOf(i); if(s) all.push(s); });
      all = uniq(all);
      if (main.length === 0) main = all.slice(0, 8);
      if (detail.length === 0) detail = all.filter(function(u){ return main.indexOf(u) === -1; });
    }

    // 가격 구간: "2개 이상 25.00" 형태의 표를 훑는다
    var tiers = [];
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
    // 수량 구간 표가 없는 레이아웃(SKU별 단가): 화면의 ¥ 가격을 모아
    // 최저~최고를 참고가로 넘긴다. "¥ 1 .28" 처럼 공백이 끼는 표기도 흡수.
    if (tiers.length === 0) {
      var prices = [];
      document.querySelectorAll('.price-info, [class*="item-price"], [class*="price-stock"], [class*="price-text"]').forEach(function(el){
        var m = (el.innerText || '').replace(/\\s+/g, '').match(/[¥￥](\\d+(?:\\.\\d+)?)/);
        if (m) { var v = parseFloat(m[1]); if (v > 0 && v < 1000000) prices.push(v); }
      });
      if (prices.length) {
        tiers.push({ minQty: 1, price: Math.min.apply(null, prices) });
        var hi = Math.max.apply(null, prices);
        if (hi > Math.min.apply(null, prices)) tiers.push({ minQty: 1, price: hi });
      }
    }

    var attrs = [];
    function addAttr(k, v){
      k = (k || '').trim(); v = (v || '').trim();
      if (!k || !v || k.length > 30 || v.length > 150) return;
      for (var i = 0; i < attrs.length; i++) if (attrs[i].label === k) return;
      attrs.push({ label: k, value: v });
    }
    // 현재 레이아웃: ant-descriptions 표 (라벨 셀/값 셀이 번갈아 나온다)
    document.querySelectorAll('.ant-descriptions-row').forEach(function(row){
      var cells = row.querySelectorAll('th,td,[class*="item-label"],[class*="item-content"]');
      for (var i = 0; i + 1 < cells.length; i += 2) addAttr(cells[i].innerText, cells[i + 1].innerText);
    });
    // 구 레이아웃 폴백
    document.querySelectorAll('.obj-content .offer-attr-list li, [class*="attribute"] li, .od-pc-attribute-item').forEach(function(li){
      var t = (li.innerText || '').trim();
      var kv = t.split(/[:：]/);
      if (kv.length >= 2) addAttr(kv[0], kv.slice(1).join(':'));
    });

    // 상품명. 현재 1688 레이아웃은 h1 이 "판매사 이름"이라 h1 을 먼저 잡으면
    // 회사명이 상품명으로 들어간다(실제 발생). 상품명 전용 클래스 → 문서 제목
    // (뒤의 "- 阿里巴巴" 꼬리 제거) → h1 순서로 잡는다.
    function pickTitle(){
      var el = document.querySelector('.title-text, .d-title, [class*="offer-title"], [class*="title-first"], [class*="subject"]');
      var t = el ? (el.innerText || '').trim().split('\\n')[0] : '';
      if (!t) t = (document.title || '').replace(/\\s*[-|–—]\\s*(阿里巴巴|1688).*$/, '').trim();
      if (!t) { var h = document.querySelector('h1'); t = h ? (h.innerText || '').trim() : ''; }
      return t;
    }
    var payload = {
      url: location.href.split('?')[0],
      extracted: {
        offerId: offer,
        title: pickTitle(),
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
        + '\\n상세이미지: ' + payload.extracted.detailImages.length + '장'
        + '\\n가격구간: ' + tiers.length + '개'
        + '\\n\\nLUVY 어드민 > 상품 수집 화면에 붙여넣기(Ctrl+V) 하세요.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(done, function(){ window.prompt('아래 내용을 복사하세요 (Ctrl+C)', json); });
    } else {
      window.prompt('아래 내용을 복사하세요 (Ctrl+C)', json);
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
