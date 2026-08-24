/* Expense request form: dynamic line items, computed total, signature, JSON submit. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) {
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  var items = [{}, {}];
  var rowsEl = $("exp-rows");
  var totalEl = $("exp-total-val");

  function parseAmount(v) {
    var n = parseFloat(String(v || "").replace(/[$,]/g, ""));
    return isFinite(n) && n >= 0 ? n : 0;
  }
  function total() {
    return items.reduce(function (s, it) { return s + parseAmount(it.amount); }, 0);
  }
  function renderItems() {
    rowsEl.innerHTML = "";
    items.forEach(function (it, i) {
      var row = document.createElement("div");
      row.className = "exp-item-row";
      row.innerHTML =
        '<input placeholder="Description of expense" maxlength="200" data-k="description" />' +
        '<input placeholder="Item" maxlength="80" data-k="item" />' +
        '<input class="exp-amt" placeholder="0.00" inputmode="decimal" data-k="amount" />' +
        '<button type="button" class="exp-rm" title="Remove line">&times;</button>';
      row.querySelectorAll("input").forEach(function (inp) {
        inp.value = it[inp.dataset.k] || "";
        inp.addEventListener("input", function () {
          it[inp.dataset.k] = inp.value;
          if (inp.dataset.k === "amount") totalEl.textContent = money(total());
        });
      });
      row.querySelector(".exp-rm").addEventListener("click", function () {
        if (items.length <= 1) return;
        items.splice(i, 1);
        renderItems();
      });
      rowsEl.appendChild(row);
    });
    totalEl.textContent = money(total());
  }
  renderItems();
  $("exp-add").addEventListener("click", function () {
    items.push({});
    renderItems();
    var last = rowsEl.lastElementChild;
    if (last) last.querySelector("input").focus();
  });

  var sig = window.FavorSig($("exp-sig"), "");
  var msg = $("exp-msg");
  var submitBtn = $("exp-submit");

  $("exp-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    msg.textContent = "";
    var name = $("exp-name").value.trim();
    var email = $("exp-email").value.trim();
    var reason = $("exp-reason").value.trim();
    var missing = [];
    if (!name) missing.push("your name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) missing.push("a valid email");
    if (total() <= 0) missing.push("at least one expense amount");
    if (!reason) missing.push("the reason");
    if (!$("exp-affirm").checked) missing.push("the affirmation");
    if (!sig.has()) missing.push("your signature");
    if (missing.length) {
      msg.textContent = "Still needed: " + missing.join(", ") + ".";
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
    fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name,
        email: email,
        travel_dates: $("exp-dates").value.trim(),
        travel_city: $("exp-city").value.trim(),
        reason: reason,
        affirm: true,
        signature: sig.value(),
        company: $("exp-hp").value,
        items: items
          .map(function (it) {
            return { description: (it.description || "").trim(), item: (it.item || "").trim(), amount: parseAmount(it.amount) };
          })
          .filter(function (it) { return it.description || it.item || it.amount > 0; }),
      }),
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (out) {
        if (!out.res.ok || !out.data.ok) throw new Error(out.data.message || "Something went wrong.");
        $("exp-done-doc").textContent = out.data.doc_number;
        $("exp-done-approver").textContent = out.data.approver_name;
        $("exp-form").hidden = true;
        $("exp-done").hidden = false;
        window.scrollTo({ top: 0 });
      })
      .catch(function (err) {
        msg.textContent = err.message || "Something went wrong. Try again.";
      })
      .then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit for approval";
      });
  });

  $("exp-again").addEventListener("click", function () {
    window.location.reload();
  });
})();
