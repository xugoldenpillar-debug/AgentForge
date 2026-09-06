/*
 * Dependency-free locale bootstrap shared by the portable shell.
 *
 * The server emits window.AgentForgeSharedMessages from src/shared/i18n/messages.ts.
 * This file is only a dependency-free adapter for the portable shell; it never
 * changes workflow values, prompts, model IDs, or user-authored content.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'agentforge.display-language';
  var ENGLISH = 'en';
  var CHINESE = 'zh-CN';
  var supported = [ENGLISH, CHINESE];

  // The server emits the shared message source before this adapter runs.
  // If that resource is unavailable, the shell remains in English instead of
  // maintaining a second translation dictionary here.
  var literalMaps = { en: {}, 'zh-CN': {} };
  var semanticMaps = { en: {}, 'zh-CN': {} };
  var errorMessageKeys = {};

  function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function flattenPair(en, zh, prefix, output) {
    if (!isObject(en) || !isObject(zh)) return;
    Object.keys(en).forEach(function (key) {
      var next = prefix ? prefix + '.' + key : key;
      if (typeof en[key] === 'string' && typeof zh[key] === 'string') {
        output.push({ key: next, en: en[key], zh: zh[key] });
      } else if (isObject(en[key]) && isObject(zh[key])) {
        flattenPair(en[key], zh[key], next, output);
      }
    });
  }

  function installShared(source) {
    if (!source) return;
    var messages = source.messages || source.locales || source;
    var pairs = [];
    flattenPair(messages.en || {}, messages[CHINESE] || {}, '', pairs);
    pairs.forEach(function (pair) {
      semanticMaps.en[pair.key] = pair.en;
      semanticMaps['zh-CN'][pair.key] = pair.zh;
      var pairKey = normalize(pair.en);
      if (!literalMaps.en[pairKey]) literalMaps.en[pairKey] = pairKey;
      literalMaps['zh-CN'][pairKey] = pair.zh;
    });
    var literals = source.literalMap || (messages && messages.literalMap);
    if (literals && isObject(literals)) {
      Object.keys(literals).forEach(function (key) {
        var value = literals[key];
        var literalKey = normalize(key);
        if (typeof value === 'string') literalMaps['zh-CN'][literalKey] = value;
        else if (isObject(value) && typeof value[CHINESE] === 'string') literalMaps['zh-CN'][literalKey] = value[CHINESE];
      });
    }
    var sharedErrorMessageKeys = source.errorMessageKeys || source.errorMessages;
    if (sharedErrorMessageKeys && isObject(sharedErrorMessageKeys)) {
      Object.keys(sharedErrorMessageKeys).forEach(function (code) {
        if (typeof sharedErrorMessageKeys[code] === 'string') errorMessageKeys[code] = sharedErrorMessageKeys[code];
      });
    }

    var systemContent = source.systemContent;
    if (systemContent && isObject(systemContent)) {
      Object.keys(systemContent).forEach(function (entity) {
        var fields = systemContent[entity];
        if (!isObject(fields)) return;
        Object.keys(fields).forEach(function (field) {
          var pair = fields[field];
          if (!isObject(pair) || typeof pair.en !== 'string' || typeof pair[CHINESE] !== 'string') return;
          var systemKey = normalize(pair.en);
          if (!literalMaps.en[systemKey]) literalMaps.en[systemKey] = systemKey;
          literalMaps['zh-CN'][systemKey] = pair[CHINESE];
        });
      });
    }
  }

  installShared(global.AgentForgeSharedMessages || global.AgentForgeMessages);

  var textOriginals = new WeakMap();
  var attributeOriginals = new WeakMap();
  var current = ENGLISH;
  var subscribers = [];

  function normalize(raw) {
    return String(raw || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function resolveLocale(raw) {
    var value = String(raw || '');
    if (value === CHINESE || value.toLowerCase().indexOf('zh-') === 0 || value.toLowerCase() === 'zh') return CHINESE;
    return ENGLISH;
  }

  function initialLocale() {
    try {
      var stored = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      if (stored === ENGLISH || stored === CHINESE) return stored;
    } catch (_) {
      // Storage may be unavailable in privacy mode; browser language is enough.
    }
    return resolveLocale(global.navigator && global.navigator.language);
  }

  function setDocumentLocale(locale) {
    if (!global.document || !global.document.documentElement) return;
    global.document.documentElement.lang = locale;
    global.document.documentElement.setAttribute('data-display-language', locale);
    // Keep data-locale as a compatibility alias for the portable shell.
    global.document.documentElement.setAttribute('data-locale', locale);
  }

  function translateText(raw) {
    var value = String(raw == null ? '' : raw);
    if (current === ENGLISH || !value.trim()) return value;
    var leading = (value.match(/^\s*/) || [''])[0];
    var trailing = (value.match(/\s*$/) || [''])[0];
    var core = value.slice(leading.length, value.length - trailing.length || value.length);
    var key = normalize(core);
    var exact = literalMaps[CHINESE][key];
    if (exact !== undefined) return leading + exact + trailing;

    // Translate only complete, adapter-generated metric labels. These patterns
    // never match arbitrary user text because the whole text node must fit.
    var dynamic;
    var match;
    if ((match = /^(\d[\d,]*) ACTIVE MISSIONS$/.exec(key))) dynamic = match[1] + ' 个进行中的挑战';
    else if ((match = /^(\d[\d,]*) ENERGY MAX \/ (\d+) TOOL CALLS$/.exec(key))) dynamic = match[1] + ' 能耗上限 / ' + match[2] + ' 次工具调用';
    else if ((match = /^WORKFLOW CANVAS \/ (\d+) NODES$/.exec(key))) dynamic = '工作流画布 / ' + match[1] + ' 个节点';
    else if ((match = /^(\d[\d,]*) energy$/.exec(key))) dynamic = match[1] + ' 能耗';
    else if ((match = /^(\d[\d,]*) tools \/ \+(\d+) REP$/.exec(key))) dynamic = match[1] + ' 个工具 / +' + match[2] + ' 声望';
    else if ((match = /^(\d+) BUILDS \/ NO RUNS$/.exec(key))) dynamic = match[1] + ' 个构建版本 / 暂无运行';
    else if ((match = /^(\d+) BUILDS \/ ([\d.]+% PASS)$/.exec(key))) dynamic = match[1] + ' 个构建版本 / ' + match[2].replace(' PASS', ' 通过');
    else if ((match = /^(\d+) versions equipped$/.exec(key))) dynamic = match[1] + ' 个版本已使用';
    else if ((match = /^(\d+) of (\d+) cases completed\.$/.exec(key))) dynamic = '已完成 ' + match[1] + ' / ' + match[2] + ' 个用例。';
    else if ((match = /^(\d+) tests passed$/.exec(key))) dynamic = '通过 ' + match[1] + ' 个测试';
    else if ((match = /^~(\d+) tokens \/ est\.$/.exec(key))) dynamic = '~' + match[1] + ' token / 估算';
    else if ((match = /^(\d+) chars$/.exec(key))) dynamic = match[1] + ' 个字符';
    else if ((match = /^\+(\d+) REP$/.exec(key))) dynamic = '+' + match[1] + ' 声望';
    else if ((match = /^RUNNING \/ (\d+) OF (\d+)$/.exec(key))) dynamic = '运行中 / ' + match[1] + ' / ' + match[2];
    else if ((match = /^(\d+) \/ (\d+) tests passed$/.exec(key))) dynamic = match[1] + ' / ' + match[2] + ' 个测试通过';
    else if ((match = /^([\d.]+) sec$/.exec(key))) dynamic = match[1] + ' 秒';
    else if ((match = /^~(\d+) tokens \/ estimate$/.exec(key))) dynamic = '~' + match[1] + ' token / 估算';
    if (dynamic !== undefined) return leading + dynamic + trailing;

    // Do not translate substrings inside a text node. A text node can contain
    // user-authored content (for example a workflow label or provider name),
    // and replacing words inside it would corrupt that content. Dynamic UI
    // strings should be rendered with explicit message keys by the adapter.
    return leading + core + trailing;
  }

  function translate(key, values) {
    var table = semanticMaps[current] || {};
    var result = table[key];
    if (result === undefined) {
      result = semanticMaps.en[key];
      if (result === undefined) result = key;
    }
    if (values && isObject(values)) {
      Object.keys(values).forEach(function (name) {
        result = result.split('{' + name + '}').join(String(values[name]));
      });
    }
    return result;
  }

  function errorMessage(code, fallback) {
    var key = typeof code === 'string' ? errorMessageKeys[code] : undefined;
    if (key && (semanticMaps[current][key] !== undefined || semanticMaps.en[key] !== undefined)) return translate(key);
    return translateText(fallback || 'Request failed.');
  }

  function shouldSkipText(node) {
    var parent = node.parentElement;
    if (!parent) return true;
    if (parent.closest('pre, textarea, code, input, [data-no-locale], .node-title, .brand, .site-footer .muted')) return true;
    return false;
  }

  function translateRoot(root) {
    if (!root || !global.document) return;
    var walker = global.document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      if (shouldSkipText(node)) continue;
      if (!textOriginals.has(node)) textOriginals.set(node, node.nodeValue || '');
      var original = textOriginals.get(node);
      var translated = translateText(original);
      if (node.nodeValue !== translated) node.nodeValue = translated;
    }
    var elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
    Array.prototype.forEach.call(elements, function (element) {
      if (element.closest && element.closest('[data-no-locale], .brand')) return;
      ['placeholder', 'title', 'aria-label', 'aria-description'].forEach(function (attribute) {
        if (!element.hasAttribute(attribute)) return;
        if (!attributeOriginals.has(element)) attributeOriginals.set(element, {});
        var originals = attributeOriginals.get(element);
        if (originals[attribute] === undefined) originals[attribute] = element.getAttribute(attribute) || '';
        var original = originals[attribute];
        element.setAttribute(attribute, current === ENGLISH ? original : translateText(original));
      });
    });
  }

  function formatLocalizedNumber(value, maximumFractionDigits) {
    try {
      return new Intl.NumberFormat(current === CHINESE ? 'zh-CN' : 'en-US', { maximumFractionDigits: maximumFractionDigits }).format(value);
    } catch (_) {
      return String(value);
    }
  }

  function formatDuration(value) {
    var numeric = Number(value) || 0;
    var amount = numeric >= 1000 ? Number((numeric / 1000).toFixed(2)) : Math.round(numeric);
    return formatLocalizedNumber(amount, 2) + (numeric >= 1000
      ? (current === CHINESE ? '秒' : 's')
      : (current === CHINESE ? '毫秒' : 'ms'));
  }

  function formatDate(value) {
    var parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value || '');
    return parsed.toLocaleDateString(current === CHINESE ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function refreshFormattedNodes(root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('[data-locale-duration]'), function (element) {
      element.textContent = formatDuration(element.getAttribute('data-locale-duration'));
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-locale-date]'), function (element) {
      element.textContent = formatDate(element.getAttribute('data-locale-date'));
    });
  }

  function apply() {
    setDocumentLocale(current);
    if (global.document && global.document.body) {
      translateRoot(global.document.body);
      refreshFormattedNodes(global.document.body);
    }
    subscribers.slice().forEach(function (listener) {
      try { listener(current); } catch (_) { /* one adapter must not break the shell */ }
    });
  }

  function setLocale(locale, persist) {
    var next = resolveLocale(locale);
    current = next;
    if (persist !== false) {
      try { global.localStorage && global.localStorage.setItem(STORAGE_KEY, next); } catch (_) { /* best effort */ }
    }
    apply();
    return current;
  }

  current = initialLocale();
  setDocumentLocale(current);
  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', apply);
    else apply();
  }

  global.AgentForgeLocale = {
    supported: supported.slice(),
    storageKey: STORAGE_KEY,
    get: function () { return current; },
    set: setLocale,
    t: translate,
    translate: translateText,
    errorMessage: errorMessage,
    apply: apply,
    registerMessages: function (source) { installShared(source); apply(); },
    subscribe: function (listener) {
      if (typeof listener !== 'function') return function () {};
      subscribers.push(listener);
      return function () { subscribers = subscribers.filter(function (item) { return item !== listener; }); };
    }
  };
})(window);
