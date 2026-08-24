/* Expense log + approver settings. Uses the same admin session as the request board. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var money = function (cents) {
    return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var fmt = function (iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
  };

  function jsonFetch(url, opts) {
    return fetch(url, opts).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data.message || "Request failed");
        return data;
      });
    });
  }

  function renderTable(rows) {
    var el = $("exp-log");
    if (!rows.length) {
      el.innerHTML = '<p class="exp-empty">No expense requests yet.</p>';
      return;
    }
    el.innerHTML =
      '<table class="exp-admin-table"><tr><th>Doc</th><th>Submitted</th><th>Requester</th><th>Approver</th><th>Status</th><th class="r">Total</th><th></th></tr>' +
      rows
        .map(function (r) {
          return (
            "<tr><td>" + esc(r.doc_number) + "</td><td>" + fmt(r.submitted_at) + "</td>" +
            "<td>" + esc(r.requester_name) + '<br/><span style="opacity:.6">' + esc(r.requester_email) + "</span></td>" +
            "<td>" + esc(r.approver_name) + "</td>" +
            '<td><span class="exp-pill ' + esc(r.status) + '">' + esc(r.status) + "</span>" +
            (r.decline_note ? '<br/><span style="opacity:.6">' + esc(r.decline_note) + "</span>" : "") + "</td>" +
            '<td class="r">' + money(r.total_cents) + "</td>" +
            "<td>" + (r.pdf ? '<a href="' + esc(r.pdf) + '" target="_blank" rel="noopener">PDF</a>' : "") + "</td></tr>"
          );
        })
        .join("") +
      "</table>";
  }

  function renderOverrides(overrides) {
    var el = $("exp-ovr-list");
    if (!overrides.length) {
      el.innerHTML = '<li class="exp-empty" style="border:none">No substitutions scheduled. The default approver gets everything.</li>';
      return;
    }
    el.innerHTML = overrides
      .map(function (o) {
        return (
          "<li><span><b>" + esc(o.name) + "</b> &lt;" + esc(o.email) + "&gt; &middot; " + esc(o.start_date) + " to " + esc(o.end_date) + "</span>" +
          '<button type="button" data-id="' + esc(o.id) + '">Remove</button></li>'
        );
      })
      .join("");
    el.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        jsonFetch("/api/expenses/settings?id=" + encodeURIComponent(b.dataset.id), { method: "DELETE" })
          .then(function (data) { renderOverrides(data.overrides); })
          .catch(function (err) { $("exp-set-msg").textContent = err.message; });
      });
    });
  }

  function loadAll() {
    return Promise.all([jsonFetch("/api/expenses"), jsonFetch("/api/expenses/settings")]).then(function (out) {
      renderTable(out[0].requests);
      $("exp-set-name").value = out[1].settings.approver_name;
      $("exp-set-email").value = out[1].settings.approver_email;
      $("exp-set-dist").value = out[1].settings.distribution.join(", ");
      renderOverrides(out[1].overrides);
      $("exp-locked").hidden = true;
      $("exp-admin").hidden = false;
    });
  }

  $("exp-login").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var msg = $("exp-login-msg");
    msg.textContent = "";
    jsonFetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("exp-password").value }),
    })
      .then(loadAll)
      .catch(function (err) { msg.textContent = err.message; });
  });

  $("exp-set-save").addEventListener("click", function () {
    var msg = $("exp-set-msg");
    msg.textContent = "";
    jsonFetch("/api/expenses/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approver_name: $("exp-set-name").value.trim(),
        approver_email: $("exp-set-email").value.trim(),
        distribution: $("exp-set-dist").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
      }),
    })
      .then(function () { msg.textContent = "Saved."; })
      .catch(function (err) { msg.textContent = err.message; });
  });

  $("exp-ovr-add").addEventListener("click", function () {
    var msg = $("exp-set-msg");
    msg.textContent = "";
    jsonFetch("/api/expenses/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_date: $("exp-ovr-start").value,
        end_date: $("exp-ovr-end").value,
        name: $("exp-ovr-name").value.trim(),
        email: $("exp-ovr-email").value.trim(),
      }),
    })
      .then(function (data) {
        renderOverrides(data.overrides);
        ["exp-ovr-start", "exp-ovr-end", "exp-ovr-name", "exp-ovr-email"].forEach(function (id) { $(id).value = ""; });
      })
      .catch(function (err) { msg.textContent = err.message; });
  });

  // Already unlocked from the board? Try loading straight away.
  loadAll().catch(function () {});
})();
