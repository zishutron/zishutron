(function(){
  "use strict";
  var firebaseConfig = {
    apiKey: "AIzaSyBU5CZxIycjaY9t12BGhWADJyAbrS8WzqY",
    authDomain: "zishu-tron.firebaseapp.com",
    databaseURL: "https://zishu-tron-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "zishu-tron",
    storageBucket: "zishu-tron.firebasestorage.app",
    messagingSenderId: "818976752868",
    appId: "1:818976752868:web:6097a46a709329a3dd18f1",
    measurementId: "G-0S122FQGJF"
  };
  var app, auth, db;
  try { app = firebase.initializeApp(firebaseConfig); auth = firebase.auth(); db = firebase.database(); } catch(e){ console.warn("Firebase init failed", e); }

  function $(s,c){ return (c||document).querySelector(s); }
  function $all(s,c){ return Array.prototype.slice.call((c||document).querySelectorAll(s)); }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function sanitizeUrl(u){ if(!u) return ""; u = String(u).trim(); if(/^(https?:|mailto:|tel:|\/|#)/i.test(u)) return u; return "https://" + u; }
  function toast(msg, type){
    var wrap = $("#toastWrap"); if(!wrap) return;
    var t = document.createElement("div");
    t.className = "toast " + (type||"success");
    var icon = type === "error"
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    t.innerHTML = icon + '<span>' + esc(msg) + '</span>';
    wrap.appendChild(t);
    setTimeout(function(){ t.style.opacity="0"; t.style.transform="translateX(20px)"; t.style.transition="all .3s"; setTimeout(function(){ t.remove(); }, 320); }, 3200);
  }

  var root = document.documentElement;
  var savedTheme = localStorage.getItem("zt-theme");
  if(savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) root.classList.add("dark");
  $("#themeToggle").addEventListener("click", function(){
    root.classList.toggle("dark");
    localStorage.setItem("zt-theme", root.classList.contains("dark") ? "dark" : "light");
  });

  var header = $("#siteHeader");
  var ticking = false;
  window.addEventListener("scroll", function(){
    if(ticking) return; ticking = true;
    requestAnimationFrame(function(){
      if(window.scrollY > 24) header.classList.add("scrolled"); else header.classList.remove("scrolled");
      ticking = false;
    });
  }, {passive:true});

  var hamburger = $("#hamburger"), mobileNav = $("#mobileNav");
  hamburger.addEventListener("click", function(){
    var open = mobileNav.classList.toggle("open");
    hamburger.classList.toggle("open", open);
    hamburger.setAttribute("aria-expanded", open);
    document.body.style.overflow = open ? "hidden" : "";
  });
  $all("a", mobileNav).forEach(function(a){
    a.addEventListener("click", function(){
      mobileNav.classList.remove("open"); hamburger.classList.remove("open");
      hamburger.setAttribute("aria-expanded","false"); document.body.style.overflow = "";
    });
  });

  var accountTrigger = $("#accountTrigger"), accountMenu = $("#accountMenu");
  if(accountTrigger){
    accountTrigger.addEventListener("click", function(e){
      e.stopPropagation();
      var open = accountMenu.classList.toggle("open");
      accountTrigger.setAttribute("aria-expanded", open);
    });
    document.addEventListener("click", function(){ accountMenu.classList.remove("open"); accountTrigger.setAttribute("aria-expanded","false"); });
    accountMenu.addEventListener("click", function(e){ e.stopPropagation(); });
  }

  $("#year").textContent = new Date().getFullYear();

  var revealObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add("in"); revealObserver.unobserve(en.target); } });
  }, {threshold:0.12, rootMargin:"0px 0px -40px 0px"});
  $all(".reveal").forEach(function(el){ revealObserver.observe(el); });

  var footerVideo = $("#footerVideo");
  if(footerVideo){
    var fvObserver = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(en.isIntersecting){
          var src = footerVideo.querySelector("source[data-src]");
          if(src){ src.src = src.getAttribute("data-src"); footerVideo.load(); footerVideo.play().catch(function(){}); }
          fvObserver.disconnect();
        }
      });
    }, {rootMargin:"200px"});
    fvObserver.observe(footerVideo);
  }

  function productInitial(title){ return (title||"Z").trim().charAt(0).toUpperCase(); }
  function statusClass(s){
    s = (s||"").toLowerCase();
    if(s === "available") return "badge-available";
    if(s === "coming soon" || s === "soon") return "badge-soon";
    return "badge-beta";
  }

  function renderProducts(products){
    var grid = $("#productsGrid"); if(!grid) return;
    var list = [];
    for(var id in products){ if(products.hasOwnProperty(id)){ var p = products[id]; if(p && p.published){ p.id = id; list.push(p); } } }
    list.sort(function(a,b){
      var ao = a.displayOrder == null ? 9999 : Number(a.displayOrder);
      var bo = b.displayOrder == null ? 9999 : Number(b.displayOrder);
      if(ao !== bo) return ao - bo;
      return (b.createdAt||0) - (a.createdAt||0);
    });
    if(list.length === 0){
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg><h3>Products coming soon</h3><p>We are currently preparing our product lineup. Check back soon to explore what we are building.</p></div>';
      return;
    }
    var html = "";
    list.forEach(function(p){
      var slug = p.slug || (p.title||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
      var url = slug ? ("/products/" + encodeURIComponent(slug) + "/") : sanitizeUrl(p.url || "#");
      var isExternal = !slug && (p.url && p.url.indexOf("http") === 0);
      var iconHtml = p.icon
        ? '<img src="'+esc(p.icon)+'" alt="" loading="lazy" onerror="this.style.display=\'none\';this.parentNode.innerHTML=\'<span class=&quot;pc-initial&quot;>'+esc(productInitial(p.title))+'</span>\';" />'
        : '<span class="pc-initial">'+esc(productInitial(p.title))+'</span>';
      var featuredBadge = p.featured ? '<span class="badge badge-featured">Featured</span>' : '';
      var status = p.status ? '<span class="badge '+statusClass(p.status)+'">'+esc(p.status)+'</span>' : '';
      html += '<article class="product-card reveal">'
        + '<div class="pc-top"><div class="pc-icon">'+iconHtml+'</div><div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">'+featuredBadge+status+'</div></div>'
        + '<div class="pc-cat">'+esc(p.category||"Product")+'</div>'
        + '<h3 class="pc-title">'+esc(p.title||"Untitled")+'</h3>'
        + '<p class="pc-desc">'+esc(p.description||"")+'</p>'
        + '<div class="pc-foot"><a href="'+esc(url)+'"'+(isExternal?' target="_blank" rel="noopener"':'')+' class="pc-link">Learn More <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg></a></div>'
        + '</article>';
    });
    grid.innerHTML = html;
    $all(".reveal", grid).forEach(function(el){ revealObserver.observe(el); });
  }

  function renderEcosystem(products){
    var grid = $("#ecoGrid"); if(!grid) return;
    var list = [];
    for(var id in products){ if(products.hasOwnProperty(id)){ var p = products[id]; if(p && p.published){ p.id = id; list.push(p); } } }
    list.sort(function(a,b){ var af = a.featured ? 0 : 1, bf = b.featured ? 0 : 1; if(af !== bf) return af - bf; return (a.displayOrder||9999) - (b.displayOrder||9999); });
    if(list.length === 0){ grid.innerHTML = ""; return; }
    var html = "";
    list.slice(0, 8).forEach(function(p){
      var slug = p.slug || (p.title||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
      var url = slug ? ("/products/" + encodeURIComponent(slug) + "/") : sanitizeUrl(p.url || "#");
      var isExternal = !slug && (p.url && p.url.indexOf("http") === 0);
      var iconHtml = p.icon
        ? '<img src="'+esc(p.icon)+'" alt="" loading="lazy" onerror="this.style.display=\'none\';this.parentNode.innerHTML=\'<span style=&quot;font-weight:800;color:var(--accent);&quot;>'+esc(productInitial(p.title))+'</span>\';" />'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';
      html += '<a href="'+esc(url)+'"'+(isExternal?' target="_blank" rel="noopener"':'')+' class="eco-card reveal">'
        + '<div class="ec-icon">'+iconHtml+'</div>'
        + '<div><h4>'+esc(p.title||"Untitled")+'</h4><p>'+esc((p.description||"").slice(0,80))+'</p></div>'
        + '</a>';
    });
    grid.innerHTML = html;
    $all(".reveal", grid).forEach(function(el){ revealObserver.observe(el); });
  }

  function renderUpdates(updates){
    var grid = $("#updatesGrid"); if(!grid) return;
    var list = [];
    for(var id in updates){ if(updates.hasOwnProperty(id)){ var u = updates[id]; if(u && u.published){ u.id = id; list.push(u); } } }
    list.sort(function(a,b){
      var ao = a.displayOrder == null ? 9999 : Number(a.displayOrder);
      var bo = b.displayOrder == null ? 9999 : Number(b.displayOrder);
      if(ao !== bo) return ao - bo;
      return (b.createdAt||0) - (a.createdAt||0);
    });
    if(list.length === 0){
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg><h3>No updates yet</h3><p>We will share news and announcements here as they happen.</p></div>';
      return;
    }
    var html = "";
    list.slice(0,6).forEach(function(u){
      var slug = u.slug || (u.title||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
      var url = slug ? ("/updates/" + encodeURIComponent(slug) + "/") : (u.url ? sanitizeUrl(u.url) : "");
      var isExternal = !slug && (u.url && u.url.indexOf("http") === 0);
      var dateStr = u.createdAt ? new Date(u.createdAt).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}) : "";
      var imgHtml = u.image
        ? '<img src="'+esc(u.image)+'" alt="" loading="lazy" onerror="this.parentNode.style.display=\'none\';" />'
        : '<div style="width:100%;height:100%;background:linear-gradient(135deg,var(--accent-glow),transparent);"></div>';
      var inner = '<div class="uc-img">'+imgHtml+'</div>'
        + '<div class="uc-body">'
        + (u.category ? '<span class="uc-cat">'+esc(u.category)+'</span>' : '')
        + '<h3 class="uc-title">'+esc(u.title||"Update")+'</h3>'
        + '<p class="uc-desc">'+esc(u.description||"")+'</p>'
        + (dateStr ? '<div class="uc-date">'+esc(dateStr)+'</div>' : '')
        + '</div>';
      if(url){ html += '<a href="'+esc(url)+'"'+(isExternal?' target="_blank" rel="noopener"':'')+' class="update-card reveal">'+inner+'</a>'; }
      else { html += '<article class="update-card reveal">'+inner+'</article>'; }
    });
    grid.innerHTML = html;
    $all(".reveal", grid).forEach(function(el){ revealObserver.observe(el); });
  }

  function loadProducts(){
    if(!db){ renderProducts({}); renderEcosystem({}); return; }
    db.ref("products")
      .orderByChild("published")
      .equalTo(true)
      .on("value", function(snap){
        var val = snap.val() || {};
        renderProducts(val); renderEcosystem(val);
        var sp = document.getElementById("statProducts");
        if(sp) sp.textContent = Object.keys(val).length;
      }, function(){ renderProducts({}); renderEcosystem({}); });
  }
  function loadUpdates(){
    if(!db){ renderUpdates({}); return; }
    db.ref("updates")
      .orderByChild("published")
      .equalTo(true)
      .on("value", function(snap){
        var val = snap.val() || {};
        renderUpdates(val);
        var su = document.getElementById("statUpdates");
        if(su) su.textContent = Object.keys(val).length;
      }, function(){ renderUpdates({}); });
  }
  function showAccount(user, profile){
    $("#loginBtn").style.display = "none";
    $("#mobileLoginBtn").style.display = "none";
    $("#accountWrap").style.display = "block";
    $("#mobileAccountBtn").style.display = "flex";
    var name = (profile && profile.displayName) || user.displayName || (user.email ? user.email.split("@")[0] : "User");
    var email = user.email || "";
    var avatar = (profile && profile.photoURL) || user.photoURL || "";
    $("#amName").textContent = name;
    $("#amEmail").textContent = email;
    var av = $("#accountAvatar");
    if(avatar){
      av.innerHTML = '<img src="'+esc(avatar)+'" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentNode.textContent=\''+esc(name.charAt(0).toUpperCase())+'\';" />';
      av.classList.remove("avatar-fallback");
    } else {
      av.textContent = name.charAt(0).toUpperCase();
      av.classList.add("avatar-fallback");
    }
  }
  function hideAccount(){
    $("#loginBtn").style.display = "";
    $("#mobileLoginBtn").style.display = "";
    $("#accountWrap").style.display = "none";
    $("#mobileAccountBtn").style.display = "none";
  }

  if(auth){
    auth.onAuthStateChanged(function(user){
      if(user){
        showAccount(user, null);
        if(db){
          db.ref("users/"+user.uid).once("value").then(function(snap){
            showAccount(user, snap.val() || {});
          }).catch(function(){});
        }
      } else { hideAccount(); }
    });
  } else { hideAccount(); }

  var signOutBtn = $("#signOutBtn");
  if(signOutBtn){
    signOutBtn.addEventListener("click", function(){
      if(!auth) return;
      auth.signOut().then(function(){ toast("Signed out", "success"); }).catch(function(){ toast("Sign out failed", "error"); });
    });
  }

  loadProducts();
  loadUpdates();
})();
