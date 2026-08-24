/* Signature widget shared by the expense form and the review page.
   window.FavorSig(mount, prefillName) -> { has(), value() } where value() is a PNG data URL. */
(function () {
  if (document.fonts && document.fonts.load) document.fonts.load("600 72px Caveat").catch(function () {});

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  window.FavorSig = function (mount, prefillName) {
    var mode = "type";
    var drawn = false;
    mount.innerHTML =
      '<div class="exp-sig-tabs">' +
      '<button type="button" data-m="type" class="on">Type</button>' +
      '<button type="button" data-m="draw">Draw</button>' +
      "</div>" +
      '<div class="exp-sig-typed">' +
      '<input placeholder="Type your full name" maxlength="80" value="' + esc(prefillName || "") + '" />' +
      '<div class="preview">' + esc(prefillName || " ") + "</div>" +
      "</div>" +
      '<div class="exp-sig-box" style="display:none">' +
      "<canvas></canvas>" +
      '<span class="hint">Sign here</span>' +
      '<button type="button" class="clear">Clear</button>' +
      "</div>";

    var tabs = mount.querySelectorAll(".exp-sig-tabs button");
    var typedWrap = mount.querySelector(".exp-sig-typed");
    var typedInput = typedWrap.querySelector("input");
    var typedPreview = typedWrap.querySelector(".preview");
    var box = mount.querySelector(".exp-sig-box");
    var canvas = mount.querySelector("canvas");
    var hint = mount.querySelector(".hint");
    var ctx = canvas.getContext("2d");
    var sized = false;

    function size() {
      if (sized || box.style.display === "none") return;
      var r = box.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0d0f0c";
      sized = true;
    }

    var pen = false;
    canvas.addEventListener("pointerdown", function (e) {
      size();
      pen = true;
      drawn = true;
      hint.style.display = "none";
      ctx.beginPath();
      ctx.moveTo(e.offsetX, e.offsetY);
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!pen) return;
      ctx.lineTo(e.offsetX, e.offsetY);
      ctx.stroke();
    });
    canvas.addEventListener("pointerup", function () { pen = false; });
    mount.querySelector(".clear").addEventListener("click", function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawn = false;
      hint.style.display = "flex";
    });
    typedInput.addEventListener("input", function () {
      typedPreview.textContent = typedInput.value || " ";
    });
    tabs.forEach(function (b) {
      b.addEventListener("click", function () {
        mode = b.dataset.m;
        tabs.forEach(function (x) { x.classList.toggle("on", x === b); });
        typedWrap.style.display = mode === "type" ? "" : "none";
        box.style.display = mode === "draw" ? "" : "none";
        size();
      });
    });

    function typedToDataUrl(text) {
      var c = document.createElement("canvas");
      c.width = 640;
      c.height = 160;
      var x = c.getContext("2d");
      x.font = "600 72px Caveat, cursive";
      x.fillStyle = "#0d0f0c";
      x.textBaseline = "middle";
      x.fillText(text, 16, 84);
      return c.toDataURL("image/png");
    }

    return {
      has: function () {
        return mode === "draw" ? drawn : typedInput.value.trim().length > 0;
      },
      value: function () {
        if (mode === "draw") return drawn ? canvas.toDataURL("image/png") : null;
        var t = typedInput.value.trim();
        return t ? typedToDataUrl(t) : null;
      },
    };
  };
})();
