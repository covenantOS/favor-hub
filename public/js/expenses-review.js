/* Approver review page: loads the request from the emailed link (token) or, for an approver signed in
   with Google, from the expense log (id). Signs, approves or declines. */
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
    var d = new Date(iso);
    return d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
  };

  var params = new URLSearchParams(window.location.search);
  var token = params.get("token") || "";
  var id = token ? "" : params.get("id") || "";
  var stage = $("exp-review-stage");
  var req = null;
  var sig = null;
  var signer = "";

  function panel(kind, title, body) {
    stage.innerHTML =
      '<div class="make-sheet"><div class="exp-status ' + kind + '"><span class="dot">' + (kind === "ok" ? "&check;" : "&times;") + "</span>" +
      "<span><b>" + esc(title) + "</b> " + esc(body) + "</span></div></div>";
  }

  function detailHtml(r) {
    var rows = r.items
      .map(function (it) {
        return "<tr><td>" + esc(it.description) + "</td><td>" + esc(it.item) + '</td><td class="r">' + money(it.amount_cents) + "</td></tr>";
      })
      .join("");
    return (
      '<div class="make-sheet exp-review-card">' +
      '<span class="exp-legend">Request ' + esc(r.doc_number) + "</span>" +
      '<div class="exp-rows">' +
      "<b>Requested by</b><span>" + esc(r.requester_name) + " &lt;" + esc(r.requester_email) + "&gt;</span>" +
      "<b>Dates</b><span>" + (esc(r.travel_dates) || "&mdash;") + "</span>" +
      "<b>City / state</b><span>" + (esc(r.travel_city) || "&mdash;") + "</span>" +
      "<b>Submitted</b><span>" + fmt(r.submitted_at) + "</span>" +
      "</div>" +
      '<table class="exp-table"><tr><th>Description</th><th>Item</th><th class="r">Est. amount</th></tr>' + rows +
      '<tr class="tot"><td colspan="2">Total estimated</td><td class="r">' + money(r.total_cents) + "</td></tr></table>" +
      '<div class="exp-rows" style="margin-top:14px"><b>Reason</b><span>' + esc(r.reason) + "</span></div>" +
      '<div class="exp-sigstamp">' +
      (r.requester_signature ? '<img src="' + r.requester_signature + '" alt="Requester signature" />' : "") +
      '<div class="meta">Signed by ' + esc(r.requester_name) + "<br/>" + fmt(r.submitted_at) + " &middot; affirmation checked</div></div>" +
      "</div>"
    );
  }

  function renderPending() {
    stage.innerHTML =
      detailHtml(req) +
      '<div class="make-sheet">' +
      '<span class="exp-legend">Approver signature &middot; ' + esc(signer || req.approver_name) + "</span>" +
      '<div id="exp-sig"></div>' +
      '<div class="exp-foot">' +
      '<button type="button" class="req-submit exp-green" id="exp-approve">Approve &amp; sign</button>' +
      '<button type="button" class="req-submit exp-danger" id="exp-decline">Decline&hellip;</button>' +
      "</div>" +
      '<div class="exp-decline-note" id="exp-decline-note">' +
      '<label class="req-field"><span>Note to the requester</span><textarea id="exp-note" maxlength="2000"></textarea></label>' +
      '<button type="button" class="req-submit exp-danger" id="exp-decline-confirm">Confirm decline</button>' +
      "</div>" +
      '<p class="req-msg" id="exp-rv-msg" aria-live="polite"></p>' +
      "</div>";
    sig = window.FavorSig($("exp-sig"), signer || req.approver_name);
    $("exp-approve").addEventListener("click", function () { decide("approve"); });
    $("exp-decline").addEventListener("click", function () {
      $("exp-decline-note").classList.toggle("on");
    });
    $("exp-decline-confirm").addEventListener("click", function () { decide("decline"); });
  }

  function decide(action) {
    var msg = $("exp-rv-msg");
    msg.textContent = "";
    if (action === "approve" && !sig.has()) {
      msg.textContent = "Sign first, then approve.";
      return;
    }
    var buttons = ["exp-approve", "exp-decline", "exp-decline-confirm"].map($);
    buttons.forEach(function (b) { if (b) b.disabled = true; });
    fetch("/api/expenses/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: token || undefined,
        id: id || undefined,
        action: action,
        signature: action === "approve" ? sig.value() : undefined,
        note: action === "decline" ? $("exp-note").value.trim() : undefined,
      }),
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (out) {
        if (!out.res.ok || !out.data.ok) throw new Error(out.data.message || "Something went wrong.");
        if (out.data.status === "approved") {
          panel(
            "ok",
            "Approved and signed.",
            out.data.emailed
              ? "The signed copy went to " + req.requester_name + ", you, and the distribution list."
              : "Saved, but the email did not send. Tell Will so he can resend it."
          );
        } else {
          panel("no", "Declined.", req.requester_name + " got your note and can fix and resubmit.");
        }
        window.scrollTo({ top: 0 });
      })
      .catch(function (err) {
        msg.textContent = err.message || "Something went wrong. Try again.";
        buttons.forEach(function (b) { if (b) b.disabled = false; });
      });
  }

  if (!token && !id) {
    panel("no", "No review link.", "Open this page from the email you were sent, or from the expense log.");
    return;
  }
  fetch("/api/expenses/review?" + (token ? "token=" + encodeURIComponent(token) : "id=" + encodeURIComponent(id)))
    .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
    .then(function (out) {
      if (out.res.status === 401 && out.data.error === "signin") {
        window.location.href = "/login/?next=" + encodeURIComponent(window.location.pathname + window.location.search);
        return;
      }
      if (!out.res.ok || !out.data.ok) throw new Error(out.data.message || "This link is not valid.");
      req = out.data.request;
      signer = out.data.signer || "";
      if (req.status === "pending") renderPending();
      else {
        stage.innerHTML = "";
        panel(
          req.status === "approved" ? "ok" : "no",
          "Already " + req.status + ".",
          "This request was decided on " + fmt(req.decided_at) + ". Nothing else to do."
        );
        stage.insertAdjacentHTML("beforeend", detailHtml(req));
      }
    })
    .catch(function (err) {
      panel("no", id ? "This request cannot be opened." : "This link is not valid.", err.message === "This link is not valid." ? "It may have been mistyped. Ask the requester to resubmit." : err.message);
    });
})();
