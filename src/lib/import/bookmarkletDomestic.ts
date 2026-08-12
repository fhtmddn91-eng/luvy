import { SOURCES } from "./sources";

/**
 * 국내 도매처(도라도라·핑크박스·러브몰·리보스·레드그룹) 상세페이지에서
 * 상품 데이터를 추출해 클립보드로 복사하는 북마클릿.
 *
 * 왜 1688 것과 파일을 나눴는가:
 *   페이지 구조가 아예 다르다. 1688 은 window.context 에 상품 전체가 들어 있어
 *   그것만 읽으면 되지만, 국내 몰은 그런 전역 데이터가 없어 표준 메타데이터
 *   (JSON-LD / og:) 와 쇼핑몰 솔루션별 셀렉터를 층층이 폴백해야 한다.
 *   한 파일에 합치면 양쪽 분기가 얽혀 어느 쪽을 고쳐도 반대편이 깨진다.
 *
 * 왜 서버에서 직접 크롤링하지 않는가:
 *   국내 도매처는 **전부 로그인·사업자 승인 뒤에만** 상품이 보인다(5곳 실측).
 *   서버가 받으면 로그인 페이지 HTML 만 온다. 대표님이 로그인한 브라우저에서
 *   뽑아야 상품 데이터가 나온다. 1688(봇 차단)과 이유는 달라도 결론은 같다.
 *
 * 추출 전략 — 표준 메타데이터 우선, DOM 은 폴백:
 *   1. JSON-LD(schema.org Product) — 상품명·이미지·가격이 한 덩어리로 있다
 *   2. og:/product: 메타태그 — 카페24가 기본 제공, 스킨을 바꿔도 살아남는다
 *   3. 솔루션별 셀렉터(카페24 #prdDetail·.xans-product-*)
 *   4. 페이지 전체 스캔 (레드그룹처럼 자체 제작 몰용 최후 폴백)
 *   레이아웃 셀렉터부터 뒤지면 스킨을 바꿀 때마다 깨진다. 1688 북마클릿에서
 *   같은 교훈을 이미 겪었다(구조화 데이터 우선 원칙).
 *
 * 사이트 판별표는 sources.ts 에서 생성해 넣는다 — 새 도매처를 붙일 때
 * 고칠 곳이 sources.ts 하나여야 한다는 원칙(CLAUDE.md)을 북마클릿까지 지킨다.
 * 손으로 복사해두면 서버 화이트리스트와 북마클릿이 따로 놀아,
 * "수집은 됐는데 이미지가 한 장도 안 받아지는" 상태가 된다.
 */

/** 북마클릿에 심을 사이트 판별표. 정규식은 문자열로 넘겨 브라우저에서 되살린다. */
export function domesticSiteTable(): string {
  const rows = SOURCES.filter((s) => s.id !== "1688").map((s) => ({
    id: s.id,
    label: s.label,
    host: s.host.source,
    imageHost: s.imageHost.source,
  }));
  return JSON.stringify(rows);
}

export function buildDomesticBookmarkletSource(): string {
  return `(function(){
  try {
    var SITES = ${domesticSiteTable()};
    var host = location.hostname.toLowerCase();
    var site = null;
    for (var i = 0; i < SITES.length; i++) {
      if (new RegExp(SITES[i].host, 'i').test(host)) { site = SITES[i]; break; }
    }
    if (!site) {
      alert('LUVY 국내 수집: 등록되지 않은 사이트입니다.\\n\\n지원 도매처: '
        + SITES.map(function(s){ return s.label; }).join(', ')
        + '\\n\\n(1688 상품은 [1688 수집] 북마크를 쓰세요)');
      return;
    }
    var IMG_HOST = new RegExp(site.imageHost, 'i');

    // ---------- 공통 도구 ----------
    /** 상대경로 보정 + 이미지 호스트 화이트리스트. 서버 검사와 같은 기준. */
    function abs(u){
      if (!u) return null;
      u = String(u).trim();
      if (!u || u.indexOf('data:') === 0) return null;
      try {
        var p = new URL(u, location.href);
        if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
        if (!IMG_HOST.test(p.hostname)) return null;
        // 서버(normalizeImageUrlFor)와 같은 확장자 검사 — 안 맞추면 여기서 센 장수와
        // 실제 등록 장수가 어긋난다. 리보스의 투명 스페이서(product/uvblankgif,
        // 확장자 없음)가 상세이미지로 세어진 실사례.
        // img: 레드그룹 이미지 서버(speedgabia)의 비표준 확장자 — 내용물은 GIF/JPEG.
        if (!/\\.(jpe?g|png|gif|webp|img)$/i.test(p.pathname)) return null;
        return 'https://' + p.hostname + p.pathname;
      } catch(e){ return null; }
    }
    function uniq(a){ var s={},o=[]; a.forEach(function(x){ if(x && !s[x]){s[x]=1;o.push(x);} }); return o; }
    function num(v){
      var n = parseFloat(String(v == null ? '' : v).replace(/[^\\d.]/g, ''));
      return isFinite(n) && n > 0 ? n : 0;
    }
    function meta(p){
      var el = document.querySelector('meta[property="' + p + '"], meta[name="' + p + '"]');
      return el ? (el.getAttribute('content') || '').trim() : '';
    }

    /**
     * 쇼핑몰 UI 이미지 걸러내기. 상품 이미지가 아닌 것들 —
     * 스킨 에셋·아이콘·버튼·배너는 경로에 티가 난다.
     * 이 컷이 없으면 장바구니 아이콘·결제 배지까지 상품 이미지로 등록된다
     * (1688 에서 플랫폼 로고가 딸려온 사고와 같은 종류).
     */
    function junkUrl(u){
      if (/\\.svg$/i.test(u)) return true;
      if (/echosting\\.cafe24\\.com/i.test(u)) return true;      // 카페24 관리·공용 에셋
      // 파일명에 logo 가 든 것도 컷 — 레드그룹은 og:image 가 루트의
      // regdroup_logo-s.png 라 디렉토리 검사(/logo/)를 빠져나갔다(실측).
      if (/logo[^/]*$/i.test(u)) return true;
      // design·category: 리보스(자체 몰)가 로고·통장이미지를 goods_img/design/ 에,
      // 사이드바의 다른 상품 썸네일을 goods_img/category/ 에 둔다(실측 K-579).
      // category 를 안 거르면 옆 상품 사진이 이 상품 상세로 딸려 들어온다.
      return /\\/(?:skin|common|banner|btn|button|icon|icons|logo|bg|sns|mobile_skin|design|category)\\//i.test(u);
    }
    /** 상품 영역이 아닌 UI 블록 — 헤더·푸터·좌우 메뉴·배너·리뷰·추천 */
    // notice: 레드그룹은 상세페이지의 "신상품" 추천 위젯이 #notice_864 에 들어 있어
    // (실측), 안 거르면 옆 상품 대표이미지 18장이 이 상품 상세로 딸려 들어온다.
    var JUNK_AREA = 'header,footer,nav,aside,#header,#footer,#gnb,#lnb,#quick,'
      + '[class*="header"],[class*="footer"],[class*="gnb"],[class*="lnb"],[class*="quick"],'
      + '[class*="banner"],[class*="logo"],[class*="popup"],[class*="review"],[class*="recommend"],'
      + '[class*="relation"],[class*="cart"],[class*="search"],[id*="header"],[id*="footer"],'
      + '[class*="notice"],[id*="notice"]';

    /** 지연 로딩 이미지는 src 가 비어 있고 data-* 에 실제 주소가 들어 있다 */
    function srcOf(img){
      return abs(img.getAttribute('src'))
          || abs(img.getAttribute('data-src'))
          || abs(img.getAttribute('ec-data-src'))
          || abs(img.getAttribute('data-original'))
          || abs(img.getAttribute('data-lazy'))
          || abs(img.getAttribute('data-echo'));
    }
    function collect(sel, skipJunkArea){
      var out = [];
      document.querySelectorAll(sel).forEach(function(el){
        var imgs = el.tagName === 'IMG' ? [el] : el.querySelectorAll('img');
        Array.prototype.forEach.call(imgs, function(i){
          if (skipJunkArea && i.closest && i.closest(JUNK_AREA)) return;
          var s = srcOf(i);
          if (s && !junkUrl(s)) out.push(s);
        });
      });
      return uniq(out);
    }

    // ---------- 1. 구조화 데이터 (JSON-LD Product) ----------
    var ld = null;
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function(s){
      if (ld) return;
      try {
        var d = JSON.parse(s.textContent);
        var list = Array.isArray(d) ? d : (d['@graph'] || [d]);
        for (var i = 0; i < list.length; i++) {
          var t = list[i] && list[i]['@type'];
          if (t === 'Product' || (Array.isArray(t) && t.indexOf('Product') >= 0)) { ld = list[i]; return; }
        }
      } catch(e){}
    });

    // ---------- 상품번호 ----------
    /**
     * 쇼핑몰 솔루션마다 상품번호 자리가 다르다. 카페24 3곳은 경로형이 정본이고,
     * 나머지는 쿼리 파라미터를 쓴다. 못 찾으면 수집을 진행하지 않는다 —
     * 중복 판정 키라서, 임의 값으로 만들면 같은 상품이 계속 새로 등록된다.
     */
    function pickProductNo(){
      var u = location.href;
      var m = u.match(/\\/product\\/[^/]+\\/(\\d+)\\//)      // 카페24 경로형
           || u.match(/[?&]product_no=(\\d+)/i)              // 카페24 쿼리형
           || u.match(/[?&]branduid=([A-Za-z0-9_-]+)/i)      // 메이크샵
           || u.match(/[?&]goodsno=(\\d+)/i)                 // 고도몰
           || u.match(/[?&]goodsCd=([A-Za-z0-9_-]+)/i)
           || u.match(/[?&](?:idx|pid|p_idx|it_id)=([A-Za-z0-9_-]+)/i)
           || u.match(/[?&]gcode=([A-Za-z0-9_-]+)/i)          // 레드그룹 (실측 gcode=1858)
           // 리보스: p_view.php?c=01/10&p=K-579 — 상품코드가 p= 에 온다.
           // p= 는 다른 몰에서 페이지 번호로도 쓰여, p_view.php 경로일 때만 믿는다.
           || (/p_view\\.php/i.test(u) ? u.match(/[?&]p=([A-Za-z0-9_-]+)/i) : null);
      if (m) return m[1];
      var inp = document.querySelector('input[name="product_no"],input[name="branduid"],input[name="goodsno"],input[name="it_id"]');
      if (inp && inp.value) return String(inp.value).trim();
      if (ld && (ld.sku || ld.productID)) return String(ld.sku || ld.productID).trim();
      // 자체 제작 몰 폴백: 본문에 "상품코드 : K-579" 처럼 적어두는 곳이 많다
      var bodyCode = (document.body.innerText || '').match(/상품\\s*코드\\s*[:：]\\s*([A-Za-z0-9_-]{2,40})/);
      if (bodyCode) return bodyCode[1];
      return null;
    }
    var productNo = pickProductNo();
    if (!productNo) {
      alert('상품 상세페이지가 아닙니다.\\n\\n상품을 하나 열고(목록이 아니라 상세) 다시 눌러주세요.');
      return;
    }

    // ---------- 상품명 ----------
    /**
     * document.title 을 먼저 쓰면 "상품명 - 쇼핑몰이름"에서 꼬리를 떼야 하는데,
     * 상품명 자체에 하이픈이 흔해 잘못 잘린다. og:title 은 카페24가 상품명만
     * 넣어주므로 그쪽을 우선한다.
     */
    function domTitle(){
      var el = document.querySelector(
        '.xans-product-detaildesign .name, .xans-product-detail .name, [class*="prdName"],'
        + '[class*="product-name"], [class*="goods_name"], .item_detail_tit, h1.tit, h2.name');
      var t = el ? (el.innerText || '').trim().split('\\n')[0] : '';
      if (t) return t;
      // 자체 제작 몰 폴백: 첫 번째 의미 있는 제목 태그. 레드그룹은 상품명이
      // 맨 h2 로만 있다(실측 "[[한국총판]-최저가준수] [OTOUCH] 플레저 엔진").
      var hs = document.querySelectorAll('h1,h2,h3');
      for (var i = 0; i < hs.length; i++) {
        var ht = (hs[i].innerText || '').trim().split('\\n')[0];
        if (ht.length >= 5 && realTitle(ht)) return ht;
      }
      return '';
    }
    // 리보스: 메타데이터가 없고 상품명이 "K-579 더커 자동확장기 [권장판매가:497,000원 ]"
    // 꼴의 맨 텍스트로만 있다(실측). 상품코드 머리와 [권장판매가...] 꼬리를 뗀다.
    function titleFromRrpText(){
      // 문서 순서로 훑으면 부모 TD(옆칸 안내문까지 포함)가 자식 FONT 보다 먼저
      // 걸린다(실측 — 상품명 뒤에 "판매가격 : ..." 안내가 통째로 붙어 나옴).
      // 가장 짧은 후보가 상품명만 담은 안쪽 요소다.
      var best = '';
      var els = document.querySelectorAll('font,b,strong,td,h1,h2,h3');
      for (var i = 0; i < els.length; i++) {
        var t = (els[i].innerText || '').replace(/\\s+/g, ' ').trim();
        if (t.length < 200 && /\\[\\s*권장판매가/.test(t) && (!best || t.length < best.length)) best = t;
      }
      return best
        ? best.replace(/\\[\\s*권장판매가[^\\]]*\\]?/, '')
              .replace(new RegExp('^\\\\s*' + productNo + '\\\\s*'), '')
              .trim()
        : '';
    }
    // og:title 이 상품명이 아니라 쇼핑몰 이름만 담긴 사이트가 있다(리보스 실측:
    // og:title="리보스", 레드그룹 실측: og:title="REDGROUP"). 한글 이름(label)과
    // 영문 id 양쪽 다 대조해, 사이트 이름이면 상품명이 아닌 것으로 보고 버린다.
    function realTitle(t){
      t = String(t || '').trim();
      if (!t || t === site.label) return '';
      if (t.toLowerCase() === site.id.toLowerCase()) return '';
      return t;
    }
    var title = realTitle(ld && ld.name) || realTitle(meta('og:title'))
             || titleFromRrpText() || domTitle() || (document.title || '').trim();

    // ---------- 대표 이미지 ----------
    var main = [];
    if (ld && ld.image) {
      (Array.isArray(ld.image) ? ld.image : [ld.image]).forEach(function(v){
        var s = abs(typeof v === 'string' ? v : (v && v.url));
        if (s && !junkUrl(s)) main.push(s);
      });
    }
    var ogImg = abs(meta('og:image'));
    if (ogImg && !junkUrl(ogImg)) main.push(ogImg);
    main = main.concat(collect(
      '.xans-product-image, #prdImgList, .keyImg, .BigImage, .thumbnail,'
      + '[class*="product-image"], [class*="goods_image"], [class*="detail_img"],'
      // 리보스: 클래스가 아예 없는 옛날 표 레이아웃 — 대표이미지는 경로로 잡는다
      + 'img[src*="goods_img/product"],'
      // 레드그룹: 상품 모듈이 #shop_view_모듈번호 (실측 #shop_view_136)
      + '[id*="shop_view"]', true));
    main = uniq(main);

    // ---------- 옵션(SKU) 썸네일 ----------
    var option = collect('.xans-product-option, [class*="option"] img, [class*="sku"] img', true)
      .filter(function(u){ return main.indexOf(u) === -1; });

    // ---------- 상세 이미지 ----------
    /**
     * 카페24는 상세설명이 #prdDetail 안에 통째로 들어간다. 자체 제작 몰은
     * 컨테이너 이름을 알 수 없어, 전용 셀렉터가 비면 페이지 전체를 훑되
     * UI 영역(JUNK_AREA)과 스킨 에셋(junkUrl)을 뺀다.
     * 국내 몰도 지연 로딩을 쓰므로 스크롤 전에 누르면 중간이 빈다 — 안내로 보완.
     */
    var detail = collect(
      '#prdDetail, #detail, .xans-product-additional, [class*="detail-cont"],'
      + '[class*="detailArea"], [class*="goods_description"], [class*="prd-detail"],'
      + '#goods_detail', false);   // 레드그룹 상세설명 영역 (실측)
    if (detail.length === 0) {
      document.querySelectorAll('img').forEach(function(i){
        if (i.closest && i.closest(JUNK_AREA)) return;
        if (i.naturalWidth > 0 && i.naturalWidth < 300) return;   // 아이콘·버튼 컷
        // 가로로 긴 장식 띠(하단 로고 455×172, 은행 안내 405×37 — 리보스 실측)는
        // 폭만 보면 통과한다. 상품 상세컷은 세로가 길므로 높이로 마저 거른다.
        if (i.naturalHeight > 0 && i.naturalHeight < 200) return;
        var s = srcOf(i);
        if (s && !junkUrl(s)) detail.push(s);
      });
      detail = uniq(detail);
    }
    detail = detail.filter(function(u){ return main.indexOf(u) === -1 && option.indexOf(u) === -1; });

    // ---------- 매입가 ----------
    var price = 0;
    if (ld && ld.offers) {
      var of = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
      price = num(of && (of.price || of.lowPrice));
    }
    if (!price) price = num(meta('product:price:amount'));
    if (!price) {
      var pe = document.querySelector(
        '#span_product_price_text, #span_product_price_sale, [id*="product_price"],'
        + '#price_text,'   // 레드그룹 판매가 자리 (실측 — 최저판매가와 구분되는 유일한 표식)
        + '[class*="price"] .val, [class*="sale_price"], [class*="product-price"]');
      if (pe) price = num((pe.innerText || '').split(/[~\\n]/)[0]);
    }
    if (!price) {
      // 자체 제작 몰 폴백: 셀렉터로 못 잡으면 "판매가격 : 290,000원" 꼴의
      // 라벨 붙은 텍스트를 본문에서 찾는다(리보스 실측 — id·class 가 아예 없음).
      // "권장판매가"(소비자 권장가)는 라벨이 달라 여기 안 걸린다 — 매입가만 잡힌다.
      var pm = (document.body.innerText || '').match(/(?:판매가격|공급가격|공급가|회원가|도매가격|도매가)\\s*[:：]\\s*([\\d,]+)\\s*원/);
      if (pm) price = num(pm[1]);
    }

    // ---------- 상품 정보 표 ----------
    var attrs = [];
    function addAttr(k, v){
      k = (k || '').replace(/\\s+/g, ' ').trim();
      v = (v || '').replace(/\\s+/g, ' ').trim();
      if (!k || !v || k.length > 30 || v.length > 150) return;
      for (var i = 0; i < attrs.length; i++) if (attrs[i].label === k) return;
      attrs.push({ label: k, value: v });
    }
    document.querySelectorAll(
      '.xans-product-detaildesign tr, [class*="product-info"] tr, [class*="goods_spec"] tr, .detail_info tr'
    ).forEach(function(row){
      var th = row.querySelector('th, .title, [class*="label"]');
      var td = row.querySelector('td, .desc, [class*="value"]');
      if (th && td) addAttr(th.innerText, td.innerText);
    });

    // ---------- 결과 ----------
    var payload = {
      url: location.href.slice(0, 500),
      site: site.id,
      extracted: {
        productNo: String(productNo),
        title: title.slice(0, 300),
        mainImages: main.slice(0, 12),
        detailImages: detail.slice(0, 60),
        optionImages: option.slice(0, 40),
        price: price,
        attributes: attrs.slice(0, 40)
      }
    };
    var json = JSON.stringify(payload);
    function done(){
      alert('LUVY 수집 데이터 복사 완료 — ' + site.label
        + '\\n\\n상품번호: ' + productNo
        + '\\n상품명: ' + (title || '(못 찾음)')
        + '\\n대표이미지: ' + payload.extracted.mainImages.length + '장'
        + '\\n상세이미지: ' + payload.extracted.detailImages.length + '장'
        + '\\n옵션이미지: ' + payload.extracted.optionImages.length + '장'
        + '\\n매입가: ' + (price ? price.toLocaleString('ko-KR') + '원' : '(못 찾음 — 직접 입력 필요)')
        + '\\n\\nLUVY 어드민 > 국내 사이트 수집 화면에 붙여넣기(Ctrl+V) 하세요.');
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
}

/**
 * 북마크 주소창에 넣을 javascript: URL — 1688 것과 같은 로더 방식이다.
 * 추출 코드를 박제하지 않고 클릭할 때마다 서버에서 최신본을 받아 실행하므로,
 * 셀렉터를 고쳐 배포하면 등록해 둔 북마크가 그대로 최신이 된다.
 *
 * 국내 몰 셀렉터는 로그인 벽 때문에 실페이지로 검증하지 못한 채 시작한다.
 * 첫 실행에서 빠지는 항목이 나오면 셀렉터를 고쳐 배포만 하면 되고,
 * 대표님이 북마크를 다시 드래그할 필요는 없다 — 이 방식을 택한 이유가 이것이다.
 */
export function domesticBookmarkletHref(): string {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://luvyb2b.com";
  const loader = `(function(){
    var s = document.createElement('script');
    s.src = '${origin}/bookmarklet-domestic.js?ts=' + Date.now();
    s.onerror = function(){ alert('LUVY 국내 수집 스크립트를 불러오지 못했습니다.\\n네트워크 연결을 확인한 뒤 다시 눌러주세요.'); };
    (document.body || document.documentElement).appendChild(s);
  })();`;
  return "javascript:" + encodeURIComponent(loader);
}
