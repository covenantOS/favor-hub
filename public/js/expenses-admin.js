/* Expense log + approver settings. Opens for the approvers by Google sign-in (or the log's code while sign-in is off). */
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
        if (!res.ok || data.ok === false) {
          var err = new Error(data.message || "Request failed");
          err.status = res.status;
          err.code = data.error;
          throw err;
        }
        return data;
      });
    });
  }

  var EVENT_LABELS = {
    submitted: "Submitted",
    approver_resolved: "Approver assigned",
    approver_notified: "Approver emailed",
    approved: "Approved and signed",
    declined: "Declined",
    decline_notified: "Requester emailed",
    distributed: "Approval emailed out",
  };

  function detailHtml(r) {
    var itemRows = r.items
      .map(function (it) {
        return "<tr><td>" + esc(it.description) + (it.item ? ' <span style="opacity:.6">· ' + esc(it.item) + "</span>" : "") +
          '</td><td class="r">' + money(it.amount_cents) + "</td></tr>";
      })
      .join("");
    var sigs = "";
    if (r.requester_signature || r.approver_signature) {
      sigs = '<div class="exp-detail-sigs">' +
        (r.requester_signature ? '<div><img src="' + esc(r.requester_signature) + '" alt="Requester signature" /><span>' + esc(r.requester_name) + " · requester</span></div>" : "") +
        (r.approver_signature ? '<div><img src="' + esc(r.approver_signature) + '" alt="Approver signature" /><span>' + esc(r.approver_name) + " · approver</span></div>" : "") +
        "</div>";
    }
    var events = (r.events || [])
      .map(function (ev, i) {
        var payload = null;
        try { payload = ev.payload ? JSON.parse(ev.payload) : null; } catch (e) { payload = null; }
        var label = EVENT_LABELS[ev.kind] || ev.kind;
        var hasEmail = payload && typeof payload.html === "string" && payload.html.length > 0;
        var meta = "";
        if (payload) {
          if (hasEmail) meta = "to " + (payload.to || []).join(", ") + (payload.sent ? "" : " (send failed)");
          else if (payload.note) meta = "note: " + payload.note;
          else if (payload.recipients) meta = "to " + payload.recipients.join(", ");
        }
        return (
          '<li><div class="exp-tl-row"><b>' + esc(label) + "</b><span>" + esc(ev.actor) + " · " + fmt(ev.created_at) + "</span></div>" +
          (meta ? '<div class="exp-tl-meta">' + esc(meta) + "</div>" : "") +
          (hasEmail
            ? '<button type="button" class="exp-tl-view" data-ev="' + i + '">View email</button>' +
              '<div class="exp-tl-frame" id="exp-tl-frame-' + r.id + "-" + i + '" hidden></div>'
            : "") +
          "</li>"
        );
      })
      .join("");
    return (
      '<div class="exp-detail">' +
      '<div class="exp-rows">' +
      "<b>Dates</b><span>" + (esc(r.travel_dates) || "&mdash;") + "</span>" +
      "<b>City / state</b><span>" + (esc(r.travel_city) || "&mdash;") + "</span>" +
      "<b>Reason</b><span>" + esc(r.reason) + "</span>" +
      "</div>" +
      '<table class="exp-table"><tr><th>Item</th><th class="r">Amount</th></tr>' + itemRows +
      '<tr class="tot"><td>Total</td><td class="r">' + money(r.total_cents) + "</td></tr></table>" +
      sigs +
      '<span class="exp-legend">Timeline</span>' +
      '<ul class="exp-timeline">' + (events || "<li>No events logged.</li>") + "</ul>" +
      "</div>"
    );
  }

  function wireDetailRow(tr, r) {
    tr.querySelectorAll(".exp-tl-view").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = btn.dataset.ev;
        var frame = document.getElementById("exp-tl-frame-" + r.id + "-" + idx);
        if (!frame) return;
        if (!frame.hidden) { frame.hidden = true; return; }
        if (!frame.dataset.filled) {
          var payload = JSON.parse(r.events[idx].payload);
          var subjectEl = document.createElement("div");
          subjectEl.className = "exp-tl-subject";
          subjectEl.textContent = "Subject: " + payload.subject;
          var iframe = document.createElement("iframe");
          iframe.setAttribute("sandbox", "");
          iframe.className = "exp-tl-iframe";
          frame.appendChild(subjectEl);
          frame.appendChild(iframe);
          iframe.srcdoc = payload.html;
          frame.dataset.filled = "1";
        }
        frame.hidden = false;
      });
    });
  }

  function renderTable(rows) {
    var el = $("exp-log");
    if (!rows.length) {
      el.innerHTML = '<p class="exp-empty">No expense requests yet.</p>';
      return;
    }
    var table = document.createElement("table");
    table.className = "exp-admin-table";
    table.innerHTML = "<tr><th>Doc</th><th>Submitted</th><th>Requester</th><th>Approver</th><th>Status</th><th class=\"r\">Total</th><th></th></tr>";
    rows.forEach(function (r) {
      var row = document.createElement("tr");
      row.className = "exp-admin-row";
      row.innerHTML =
        "<td>" + esc(r.doc_number) + "</td><td>" + fmt(r.submitted_at) + "</td>" +
        "<td>" + esc(r.requester_name) + '<br/><span style="opacity:.6">' + esc(r.requester_email) + "</span></td>" +
        "<td>" + esc(r.approver_name) + "</td>" +
        '<td><span class="exp-pill ' + esc(r.status) + '">' + esc(r.status) + "</span>" +
        (r.decline_note ? '<br/><span style="opacity:.6">' + esc(r.decline_note) + "</span>" : "") + "</td>" +
        '<td class="r">' + money(r.total_cents) + "</td>" +
        "<td>" + (r.pdf ? '<a href="' + esc(r.pdf) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">PDF</a>' : "") + "</td>";
      var detailRow = document.createElement("tr");
      detailRow.className = "exp-admin-detail";
      detailRow.hidden = true;
      var cell = document.createElement("td");
      cell.colSpan = 7;
      cell.innerHTML = detailHtml(r);
      detailRow.appendChild(cell);
      wireDetailRow(detailRow, r);
      row.addEventListener("click", function () { detailRow.hidden = !detailRow.hidden; });
      table.appendChild(row);
      table.appendChild(detailRow);
    });
    el.innerHTML = "";
    el.appendChild(table);
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
      $("exp-set-mi-rate").value = out[1].mileage.rate_cents;
      $("exp-set-mi-ded").value = out[1].mileage.deduction_miles;
      $("exp-set-viewers").value = (out[1].settings.viewers || []).join(", ");
      renderOverrides(out[1].overrides);
      $("exp-locked").hidden = true;
      $("exp-denied").hidden = true;
      $("exp-admin").hidden = false;
      // Signed in with Google: no code to manage and nothing to lock (sign out is in the header).
      $("exp-lock").hidden = viaGoogle;
      $("exp-code-section").hidden = viaGoogle || signinOn;
    });
  }

  function saveSettings(msgId) {
    var msg = $(msgId);
    msg.textContent = "";
    jsonFetch("/api/expenses/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approver_name: $("exp-set-name").value.trim(),
        approver_email: $("exp-set-email").value.trim(),
        distribution: $("exp-set-dist").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
        mileage_rate_cents: parseInt($("exp-set-mi-rate").value, 10),
        mileage_deduction_miles: parseInt($("exp-set-mi-ded").value, 10),
        viewers: $("exp-set-viewers").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
      }),
    })
      .then(function () { msg.textContent = "Saved."; })
      .catch(function (err) { msg.textContent = err.message; });
  }

  $("exp-login").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var msg = $("exp-login-msg");
    msg.textContent = "";
    jsonFetch("/api/admin/expense-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("exp-password").value }),
    })
      .then(loadAll)
      .catch(function (err) { msg.textContent = err.message; });
  });

  $("exp-set-save").addEventListener("click", function () { saveSettings("exp-set-msg"); });
  $("exp-viewers-save").addEventListener("click", function () { saveSettings("exp-viewers-msg"); });
  $("exp-set-mi-save").addEventListener("click", function () { saveSettings("exp-set-mi-msg"); });

  $("exp-code-save").addEventListener("click", function () {
    var msg = $("exp-code-msg");
    msg.textContent = "";
    jsonFetch("/api/admin/expense-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: $("exp-code-new").value, confirm: $("exp-code-confirm").value }),
    })
      .then(function () {
        msg.textContent = "Code updated. Use it on the next sign-in.";
        $("exp-code-new").value = "";
        $("exp-code-confirm").value = "";
      })
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

  $("exp-lock").addEventListener("click", function () {
    jsonFetch("/api/admin/expense-logout", { method: "POST" }).catch(function () {}).then(function () {
      window.location.reload();
    });
  });

  var viaGoogle = false;
  var signinOn = false;

  // Signed in with Google, the log opens for the approvers and the people they add. Before sign-in
  // is switched on, a browser that is not signed in still gets the code box.
  fetch("/api/auth/me", { credentials: "same-origin" })
    .then(function (r) { return r.json(); })
    .catch(function () { return {}; })
    .then(function (me) {
      viaGoogle = Boolean(me && me.signedIn && me.user && me.user.via === "google");
      signinOn = Boolean(me && me.enforce);
      return loadAll();
    })
    .catch(function (err) {
      if (err.code === "signin") {
        window.location.href = "/login/?next=" + encodeURIComponent(window.location.pathname);
        return;
      }
      if (err.code === "not_on_list") {
        $("exp-denied-msg").textContent = err.message;
        $("exp-denied").hidden = false;
        return;
      }
      $("exp-locked").hidden = false;
    });
})();
