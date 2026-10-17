// Small DOM helpers: non-blocking messages (instead of alert()), the reconnect banner and a
// WebGL check.

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

export function hasWebGL() {
  try {
    var canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

// A message that fades away by itself and never blocks the page.
export function showToast(root, message, level) {
  var holder = root.querySelector('.dmt-toasts');

  if (!holder) {
    holder = document.createElement('div');
    holder.className = 'dmt-toasts';
    holder.setAttribute('role', 'status');
    holder.setAttribute('aria-live', 'polite');
    root.appendChild(holder);
  }

  var toast = document.createElement('div');
  toast.className = 'dmt-toast' + (level === 'error' ? ' dmt-toast-error' : '');
  toast.textContent = String(message);
  holder.appendChild(toast);

  setTimeout(
    function () {
      toast.classList.add('dmt-toast-hide');
      setTimeout(function () {
        toast.remove();
      }, 400);
    },
    level === 'error' ? 6000 : 3500,
  );
}

// "Reconnecting..." strip at the top of the viewer.
export function createBanner(root) {
  var banner = document.createElement('div');
  banner.id = 'dmt-banner';
  banner.setAttribute('role', 'status');
  banner.style.display = 'none';
  root.appendChild(banner);

  return {
    update: function (status) {
      var text = '';

      if (status.state === 'reconnecting') {
        var seconds = status.delayMs ? Math.ceil(status.delayMs / 1000) : 0;
        text = 'Connection lost. Reconnecting' + (seconds ? ' in ' + seconds + ' s' : '') + '…';
      } else if (status.state === 'connecting') {
        text = 'Connecting…';
      } else if (status.state === 'failed') {
        text = status.message || 'Could not connect.';
      }

      banner.textContent = text;
      banner.style.display = text === '' ? 'none' : 'block';
      banner.setAttribute('data-state', status.state);
    },
  };
}
