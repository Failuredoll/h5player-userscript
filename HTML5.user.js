// ==UserScript==
// @name         HTML5视频播放器增强
// @version      1.1.0
// @description  倍速播放 Z/X/C，支持所有H5视频网站
// @author       None
// @match        *://*/*
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  // ========== hackAttachShadow ==========
  (function hackAttachShadow() {
    if (window._hasHackAttachShadow_) return;
    try {
      window._shadowDomList_ = window._shadowDomList_ || [];
      window.Element.prototype._attachShadow = window.Element.prototype.attachShadow;
      window.Element.prototype.attachShadow = function () {
        var arg = arguments;
        if (arg[0] && arg[0].mode) arg[0].mode = 'open';
        var shadowRoot = this._attachShadow.apply(this, arg);
        window._shadowDomList_.push(shadowRoot);
        return shadowRoot;
      };
      window._hasHackAttachShadow_ = true;
    } catch (e) {}
  })();

  // ========== 工具函数 ==========
  function between(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function isEditableTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function isVideoValid(video) {
    return video && video.isConnected && video.tagName === 'VIDEO';
  }

  // ========== 视频扫描引擎 ==========
  var _lastScanTime = 0;
  var _cachedVideo = null;

  function scanInto(resultSet, context) {
    var videos = context.querySelectorAll('video');
    for (var i = 0; i < videos.length; i++) {
      resultSet.add(videos[i]);
    }
  }

  function doScan() {
    _lastScanTime = Date.now();
    _videoSet.clear();

    try { scanInto(_videoSet, document); } catch (e) {}

    if (window._shadowDomList_) {
      for (var i = 0; i < window._shadowDomList_.length; i++) {
        try { scanInto(_videoSet, window._shadowDomList_[i]); } catch (e) {}
      }
    }

    var iframes = document.querySelectorAll('iframe');
    for (var j = 0; j < iframes.length; j++) {
      try {
        if (iframes[j].contentDocument) {
          scanInto(_videoSet, iframes[j].contentDocument);
        }
      } catch (e) {}
    }

    // 更新缓存：优先当前活跃视频
    _cachedVideo = null;
    var iter = _videoSet.values();
    for (var entry = iter.next(); !entry.done; entry = iter.next()) {
      var v = entry.value;
      if (!v.paused) {
        _cachedVideo = v;
        break;
      }
    }
    if (!_cachedVideo && _videoSet.size > 0) {
      _cachedVideo = _videoSet.values().next().value;
    }

    return _videoSet;
  }

  var _videoSet = new Set();

  function getVideo(revalidate) {
    // 快速路径：缓存有效 + 不强制刷新 → 直接返回
    if (!revalidate && isVideoValid(_cachedVideo)) {
      return _cachedVideo;
    }

    // 节流：500ms 内不重复全量扫描
    if (Date.now() - _lastScanTime < 500 && isVideoValid(_cachedVideo)) {
      return _cachedVideo;
    }

    _videoSet = doScan();
    return _cachedVideo;
  }

  // ========== Toast 提示 ==========
  function showToast(text, video) {
    if (!video || !video.parentNode) return;

    var container = video.parentNode;
    var toast = container.__h5p_toast__;

    if (!toast) {
      var pos = window.getComputedStyle(container).position;
      if (pos === 'static') {
        container.style.position = 'relative';
      }
      toast = document.createElement('div');
      toast.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);'
        + 'padding:10px 20px;font-size:18px;color:#fff;background:rgba(0,0,0,0.7);'
        + 'border-radius:6px;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity 0.15s;';
      container.appendChild(toast);
      container.__h5p_toast__ = toast;
    }

    toast.textContent = text;
    toast.style.opacity = '1';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(function () { toast.style.opacity = '0'; }, 1200);
  }

  // ========== 倍速控制 ==========
  var lastPlaybackRate = 1;

  function getCurrentPlaybackRate(video) {
    if (!video) return 1;
    var rate = Number(video.playbackRate);
    return rate > 0 ? rate : 1;
  }

  function setPlaybackRate(video, rate) {
    if (!video) return;
    rate = between(Number(rate) || 1, 0.1, 16);
    rate = Math.round(rate * 10) / 10;
    video.playbackRate = rate;
    showToast(rate.toFixed(1) + 'x', video);

    // 仅当已知有其他视频时才同步（避免无效扫描）
    if (_videoSet && _videoSet.size > 1) {
      var iter = _videoSet.values();
      for (var entry = iter.next(); !entry.done; entry = iter.next()) {
        var v = entry.value;
        if (v !== video) {
          try { v.playbackRate = rate; } catch (e) {}
        }
      }
    }
  }

  function changeRate(delta) {
    var video = getVideo(false);
    if (!video) { video = getVideo(true); }
    if (!video) return;
    var current = getCurrentPlaybackRate(video);
    var newRate = between(current + delta, 0.1, 16);
    newRate = Math.round(newRate * 10) / 10;
    setPlaybackRate(video, newRate);
  }

  function toggleRate() {
    var video = getVideo(false);
    if (!video) { video = getVideo(true); }
    if (!video) return;
    var current = getCurrentPlaybackRate(video);
    var target;
    if (current === 1) {
      target = lastPlaybackRate;
    } else {
      lastPlaybackRate = current;
      target = 1;
    }
    setPlaybackRate(video, target);
  }

  function seekTime(seconds) {
    var video = getVideo(false);
    if (!video) { video = getVideo(true); }
    if (!video) return;
    var newTime = video.currentTime + seconds;
    if (newTime < 0) newTime = 0;
    if (video.duration && newTime > video.duration) newTime = video.duration;
    video.currentTime = newTime;
    var sign = seconds >= 0 ? '+' : '';
    showToast(sign + seconds + 's', video);
  }

  // ========== 键盘事件 ==========
  document.addEventListener('keydown', function (e) {
    if (isEditableTarget(e.target)) return;

    // 仅允许 Ctrl+←/→（快退/快进），其他组合键忽略
    if (e.altKey || e.metaKey) return;
    if (e.ctrlKey && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;

    switch (e.code) {
      case 'KeyX':
        if (e.ctrlKey) return;
        e.preventDefault(); e.stopPropagation();
        changeRate(-0.1);
        break;
      case 'KeyC':
        if (e.ctrlKey) return;
        e.preventDefault(); e.stopPropagation();
        changeRate(+0.1);
        break;
      case 'KeyZ':
        if (e.ctrlKey) return;
        e.preventDefault(); e.stopPropagation();
        toggleRate();
        break;
      case 'ArrowLeft':
        if (!e.ctrlKey) return;
        e.preventDefault(); e.stopPropagation();
        seekTime(-30);
        break;
      case 'ArrowRight':
        if (!e.ctrlKey) return;
        e.preventDefault(); e.stopPropagation();
        seekTime(+30);
        break;
    }
  }, true);

  // ========== 初始化 ==========
  // 延迟首扫，让 document.body 先就绪
  if (document.body) {
    _videoSet = doScan();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      _videoSet = doScan();
    });
  }

  // MutationObserver：节流到每 500ms 最多一次扫描
  var _moTimer = 0;
  if (document.documentElement) {
    new MutationObserver(function () {
      clearTimeout(_moTimer);
      _moTimer = setTimeout(function () {
        if (Date.now() - _lastScanTime >= 500) {
          _videoSet = doScan();
        }
      }, 500);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // 兜底定时扫描：5s（仅在新标签页/无视频时保持激活，有缓存则跳过）
  setInterval(function () {
    if (!isVideoValid(_cachedVideo)) {
      _videoSet = doScan();
    }
  }, 5000);

})();
