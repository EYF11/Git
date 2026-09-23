/**
 * FlClash 中文完整版覆写 v1.4
 * 适用：FlClash + Mihomo 内核
 * 目标：中文策略组、地区“自动测速 + 手动锁定”双模式、Gemini 美国专组、AI 独立分流、国内直连、广告拦截、Fake-IP + DoH、防 DNS 泄漏取向。
 *
 * 重要：
 * 1) FlClash「设置 → 网络 → 覆写 DNS」请关闭。
 * 2) FlClash「追加系统 DNS」请关闭。
 * 3) 出站模式请使用「规则」；Android 推荐 TUN 模式。
 * 4) 本脚本降低 DNS 泄漏风险，但不能隐藏 TLS SNI、目标 IP 等所有网络元数据。
 */

const SETTINGS = {
  // 手机端兼顾稳定、耗电与切换频率：10 分钟复测；差距 <80ms 不频繁换节点。
  TEST_URL: "https://www.gstatic.com/generate_204",
  GEMINI_TEST_URL: "https://gemini.google.com/",
  TEST_INTERVAL: 600,
  TEST_TOLERANCE: 80,

  // 默认关闭：在 UDP 质量很差的网络里可改为 true，强制 HTTPS 回落 TCP。
  // 开启可能降低 YouTube/Google 等服务速度，所以默认不建议。
  BLOCK_QUIC: false,
};

const GROUP = {
  MAIN: "🚀 节点选择",
  AUTO: "♻️ 自动选择",
  AI: "🤖 AI 服务",
  GEMINI: "💎 Gemini",
  GEMINI_US: "🇺🇸 Gemini美国",
  GOOGLE: "🔍 Google",
  YOUTUBE: "📺 YouTube",
  TELEGRAM: "✈️ Telegram",
  GITHUB: "🐙 GitHub",
  SOCIAL: "🌐 海外社交",
  STREAMING: "🎬 流媒体",
  APPLE: "🍎 Apple",
  MICROSOFT: "🪟 Microsoft",
  ADS: "🛑 广告拦截",
  DIRECT: "🎯 国内直连",
  FINAL: "🐟 漏网之鱼",

  HK: "🇭🇰 香港节点",
  TW: "🇹🇼 台湾节点",
  JP: "🇯🇵 日本节点",
  SG: "🇸🇬 新加坡节点",
  US: "🇺🇸 美国节点",
  KR: "🇰🇷 韩国节点",
  OTHER: "🌍 其他节点",
  ALL: "🧭 全部节点",

  HK_AUTO: "🇭🇰 香港自动",
  TW_AUTO: "🇹🇼 台湾自动",
  JP_AUTO: "🇯🇵 日本自动",
  SG_AUTO: "🇸🇬 新加坡自动",
  US_AUTO: "🇺🇸 美国自动",
  KR_AUTO: "🇰🇷 韩国自动",
};

// 常见机场信息/到期/流量节点，不纳入测速池。
const INFO_FILTER =
  "(?i)(流量|剩余|到期|套餐|官网|客服|更新|订阅|使用说明|公告|traffic|expire|expiry|网址|联系|邮箱|email)";

const REGION = {
  HK: "(?i)(香港|港|🇭🇰|Hong[ ._-]*Kong|(^|[^A-Za-z])HK([^A-Za-z]|$))",
  TW: "(?i)(台湾|臺灣|台灣|🇹🇼|Taiwan|(^|[^A-Za-z])TW([^A-Za-z]|$))",
  JP: "(?i)(日本|🇯🇵|Japan|Tokyo|Osaka|(^|[^A-Za-z])JP([^A-Za-z]|$))",
  SG: "(?i)(新加坡|狮城|獅城|🇸🇬|Singapore|(^|[^A-Za-z])SG([^A-Za-z]|$))",
  US: "(?i)(美国|美國|🇺🇸|United[ ._-]*States|America|Los[ ._-]*Angeles|San[ ._-]*Jose|Seattle|Dallas|New[ ._-]*York|(^|[^A-Za-z])US(A)?([^A-Za-z]|$))",
  KR: "(?i)(韩国|韓國|🇰🇷|Korea|Seoul|(^|[^A-Za-z])KR([^A-Za-z]|$))",
};

const ALL_REGION_FILTER = [REGION.HK, REGION.TW, REGION.JP, REGION.SG, REGION.US, REGION.KR]
  .map(function (x) { return "(?:" + x.replace(/^\(\?i\)/, "") + ")"; })
  .join("|");

function urlTestGroup(name, filter, url, expectedStatus, emptyFallback) {
  const group = {
    name: name,
    type: "url-test",
    "include-all": true,
    url: url || SETTINGS.TEST_URL,
    interval: SETTINGS.TEST_INTERVAL,
    tolerance: SETTINGS.TEST_TOLERANCE,
    lazy: true,
    "exclude-filter": INFO_FILTER,
    "empty-fallback": emptyFallback || "DIRECT",
  };
  if (filter) group.filter = filter;
  if (expectedStatus) group["expected-status"] = expectedStatus;
  return group;
}

function selectGroup(name, proxies) {
  return { name: name, type: "select", proxies: proxies };
}

// 地区组保留手动 select，同时把对应“XX自动”放在第一项。
// 新导入时默认自动测速；需要固定 IP/节点时，进入地区组手动锁定具体节点即可。
// 注意：地区匹配依据节点名称，不是实时检测出口 IP。
function manualRegionGroup(name, filter, autoGroup, excludeFilter) {
  const group = {
    name: name,
    type: "select",
    proxies: autoGroup ? [autoGroup] : [],
    "include-all": true,
    filter: filter,
    "exclude-filter": excludeFilter || INFO_FILTER,
    "exclude-type": "direct",
    "empty-fallback": "DIRECT",
  };
  return group;
}

function provider(name, behavior, path, url) {
  return {
    type: "http",
    behavior: behavior,
    format: "mrs",
    path: "./ruleset/" + path,
    url: url,
    interval: 86400,
    // 规则集通过代理更新，减少 GitHub Raw 在直连网络下不稳定的问题。
    proxy: GROUP.MAIN,
  };
}

function buildRuleProviders() {
  const base = "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/";
  return {
    private_domain: provider("private_domain", "domain", "private.mrs", base + "geosite/private.mrs"),
    ads_domain: provider("ads_domain", "domain", "category-ads-all.mrs", base + "geosite/category-ads-all.mrs"),
    ai_domain: provider("ai_domain", "domain", "category-ai-!cn.mrs", base + "geosite/category-ai-!cn.mrs"),
    google_domain: provider("google_domain", "domain", "google.mrs", base + "geosite/google.mrs"),
    youtube_domain: provider("youtube_domain", "domain", "youtube.mrs", base + "geosite/youtube.mrs"),
    telegram_domain: provider("telegram_domain", "domain", "telegram.mrs", base + "geosite/telegram.mrs"),
    github_domain: provider("github_domain", "domain", "github.mrs", base + "geosite/github.mrs"),
    twitter_domain: provider("twitter_domain", "domain", "twitter.mrs", base + "geosite/twitter.mrs"),
    facebook_domain: provider("facebook_domain", "domain", "facebook.mrs", base + "geosite/facebook.mrs"),
    instagram_domain: provider("instagram_domain", "domain", "instagram.mrs", base + "geosite/instagram.mrs"),
    netflix_domain: provider("netflix_domain", "domain", "netflix.mrs", base + "geosite/netflix.mrs"),
    spotify_domain: provider("spotify_domain", "domain", "spotify.mrs", base + "geosite/spotify.mrs"),
    proxymedia_domain: provider("proxymedia_domain", "domain", "proxymedia.mrs", base + "geosite/proxymedia.mrs"),
    apple_domain: provider("apple_domain", "domain", "apple.mrs", base + "geosite/apple.mrs"),
    microsoft_domain: provider("microsoft_domain", "domain", "microsoft.mrs", base + "geosite/microsoft.mrs"),
    geolocation_non_cn: provider("geolocation_non_cn", "domain", "geolocation-!cn.mrs", base + "geosite/geolocation-!cn.mrs"),
    cn_domain: provider("cn_domain", "domain", "cn.mrs", base + "geosite/cn.mrs"),
    private_ip: provider("private_ip", "ipcidr", "private-ip.mrs", base + "geoip/private.mrs"),
    telegram_ip: provider("telegram_ip", "ipcidr", "telegram-ip.mrs", base + "geoip/telegram.mrs"),
    cn_ip: provider("cn_ip", "ipcidr", "cn-ip.mrs", base + "geoip/cn.mrs"),
  };
}

function buildGroups() {
  // 全节点自动测速。
  const auto = urlTestGroup(GROUP.AUTO, null);

  // 每个主要地区都提供独立 url-test 自动组。
  const usAuto = urlTestGroup(GROUP.US_AUTO, REGION.US);
  const sgAuto = urlTestGroup(GROUP.SG_AUTO, REGION.SG);
  const jpAuto = urlTestGroup(GROUP.JP_AUTO, REGION.JP);
  const hkAuto = urlTestGroup(GROUP.HK_AUTO, REGION.HK);
  const twAuto = urlTestGroup(GROUP.TW_AUTO, REGION.TW);
  const krAuto = urlTestGroup(GROUP.KR_AUTO, REGION.KR);

  // Gemini 美国候选组：只纳入美国节点，并直接用 Gemini 官网做健康检查。
  // expected-status 只能判断 HTTP 可达性，不能读取网页正文，因此它不是“100% 解锁证明”。
  // 若所有候选均失败则 REJECT，避免 Gemini 意外回落到 DIRECT 暴露本地出口。
  const geminiUs = urlTestGroup(
    GROUP.GEMINI_US,
    REGION.US,
    SETTINGS.GEMINI_TEST_URL,
    "200-399",
    "REJECT"
  );

  // 地区手动组第一项就是对应自动组；同时仍可手动钉死具体节点。
  const us = manualRegionGroup(GROUP.US, REGION.US, GROUP.US_AUTO);
  const sg = manualRegionGroup(GROUP.SG, REGION.SG, GROUP.SG_AUTO);
  const jp = manualRegionGroup(GROUP.JP, REGION.JP, GROUP.JP_AUTO);
  const hk = manualRegionGroup(GROUP.HK, REGION.HK, GROUP.HK_AUTO);
  const tw = manualRegionGroup(GROUP.TW, REGION.TW, GROUP.TW_AUTO);
  const kr = manualRegionGroup(GROUP.KR, REGION.KR, GROUP.KR_AUTO);

  const other = manualRegionGroup(
    GROUP.OTHER,
    ".*",
    null,
    "(?i)(" + INFO_FILTER.replace(/^\(\?i\)/, "") + "|" + ALL_REGION_FILTER + ")"
  );

  const allNodes = {
    name: GROUP.ALL,
    type: "select",
    "include-all": true,
    "exclude-filter": INFO_FILTER,
    "exclude-type": "direct",
    "empty-fallback": "DIRECT",
  };

  return [
    // 总开关：既能直接选地区自动，也能进入地区手动组。
    selectGroup(GROUP.MAIN, [
      GROUP.AUTO,
      GROUP.US_AUTO,
      GROUP.SG_AUTO,
      GROUP.JP_AUTO,
      GROUP.HK_AUTO,
      GROUP.TW_AUTO,
      GROUP.KR_AUTO,
      GROUP.US,
      GROUP.SG,
      GROUP.JP,
      GROUP.HK,
      GROUP.TW,
      GROUP.KR,
      GROUP.OTHER,
      GROUP.ALL,
      "DIRECT",
    ]),

    auto,
    usAuto,
    sgAuto,
    jpAuto,
    hkAuto,
    twAuto,
    krAuto,
    geminiUs,
    us,
    sg,
    jp,
    hk,
    tw,
    kr,
    other,
    allNodes,

    // Gemini 默认使用专门的美国实站测速组；保留手动美国节点和其他自动组作为备用。
    selectGroup(GROUP.GEMINI, [
      GROUP.GEMINI_US,
      GROUP.US_AUTO,
      GROUP.US,
      GROUP.SG_AUTO,
      GROUP.JP_AUTO,
      GROUP.AUTO,
      GROUP.MAIN,
    ]),

    // 其他 AI 默认美国自动；也可切换新加坡/日本自动，或进入地区组锁死具体节点。
    selectGroup(GROUP.AI, [
      GROUP.US_AUTO,
      GROUP.SG_AUTO,
      GROUP.JP_AUTO,
      GROUP.US,
      GROUP.SG,
      GROUP.JP,
      GROUP.AUTO,
      GROUP.MAIN,
    ]),

    selectGroup(GROUP.GOOGLE, [
      GROUP.MAIN,
      GROUP.US_AUTO,
      GROUP.SG_AUTO,
      GROUP.JP_AUTO,
      GROUP.HK_AUTO,
      GROUP.US,
      GROUP.SG,
      GROUP.JP,
      GROUP.HK,
    ]),

    selectGroup(GROUP.YOUTUBE, [
      GROUP.MAIN,
      GROUP.HK_AUTO,
      GROUP.SG_AUTO,
      GROUP.JP_AUTO,
      GROUP.US_AUTO,
      GROUP.HK,
      GROUP.SG,
      GROUP.JP,
      GROUP.US,
    ]),

    selectGroup(GROUP.TELEGRAM, [
      GROUP.MAIN,
      GROUP.SG_AUTO,
      GROUP.HK_AUTO,
      GROUP.JP_AUTO,
      GROUP.US_AUTO,
      GROUP.SG,
      GROUP.HK,
      GROUP.JP,
      GROUP.US,
    ]),

    selectGroup(GROUP.GITHUB, [
      GROUP.MAIN,
      GROUP.AUTO,
      GROUP.US_AUTO,
      GROUP.SG_AUTO,
      GROUP.JP_AUTO,
      GROUP.US,
      GROUP.SG,
      GROUP.JP,
    ]),

    selectGroup(GROUP.SOCIAL, [
      GROUP.MAIN,
      GROUP.SG_AUTO,
      GROUP.HK_AUTO,
      GROUP.JP_AUTO,
      GROUP.US_AUTO,
      GROUP.SG,
      GROUP.HK,
      GROUP.JP,
      GROUP.US,
    ]),

    selectGroup(GROUP.STREAMING, [
      GROUP.SG_AUTO,
      GROUP.JP_AUTO,
      GROUP.US_AUTO,
      GROUP.HK_AUTO,
      GROUP.SG,
      GROUP.JP,
      GROUP.US,
      GROUP.HK,
      GROUP.MAIN,
    ]),

    selectGroup(GROUP.APPLE, ["DIRECT", GROUP.MAIN, GROUP.HK_AUTO, GROUP.US_AUTO, GROUP.HK, GROUP.US]),
    selectGroup(GROUP.MICROSOFT, ["DIRECT", GROUP.MAIN, GROUP.US_AUTO, GROUP.SG_AUTO, GROUP.US, GROUP.SG]),
    selectGroup(GROUP.ADS, ["REJECT", "DIRECT"]),
    selectGroup(GROUP.DIRECT, ["DIRECT", GROUP.MAIN]),
    selectGroup(GROUP.FINAL, [GROUP.MAIN, GROUP.AUTO, "DIRECT"]),
  ];
}

function buildRules() {
  const rules = [
    // 局域网与广告优先
    "RULE-SET,private_domain,DIRECT",
    "RULE-SET,private_ip,DIRECT,no-resolve",
    "RULE-SET,ads_domain," + GROUP.ADS,

    // IP 检测站固定走主代理，避免被 CN 规则误判成直连。
    "DOMAIN-SUFFIX,ip.sb," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ipinfo.io," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ipify.org," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ifconfig.me," + GROUP.MAIN,
    "DOMAIN-SUFFIX,icanhazip.com," + GROUP.MAIN,
    "DOMAIN-SUFFIX,whatismyipaddress.com," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ip-api.com," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ipapi.co," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ipleak.net," + GROUP.MAIN,
    "DOMAIN-SUFFIX,browserleaks.com," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ping0.cc," + GROUP.MAIN,
    "DOMAIN-SUFFIX,ip111.cn," + GROUP.MAIN,

    // Gemini 必须放在通用 AI / Google 规则前面，避免先被 ai_domain/google_domain 捕获。
    "DOMAIN-SUFFIX,gemini.google.com," + GROUP.GEMINI,
    "DOMAIN-SUFFIX,bard.google.com," + GROUP.GEMINI,
    "DOMAIN-SUFFIX,aistudio.google.com," + GROUP.GEMINI,
    "DOMAIN-SUFFIX,makersuite.google.com," + GROUP.GEMINI,
    "DOMAIN-SUFFIX,ai.google.dev," + GROUP.GEMINI,
    "DOMAIN-SUFFIX,generativelanguage.googleapis.com," + GROUP.GEMINI,

    // AI / 开发 / 通讯
    "RULE-SET,ai_domain," + GROUP.AI,
    "DOMAIN-SUFFIX,openai.com," + GROUP.AI,
    "DOMAIN-SUFFIX,chatgpt.com," + GROUP.AI,
    "DOMAIN-SUFFIX,oaistatic.com," + GROUP.AI,
    "DOMAIN-SUFFIX,oaiusercontent.com," + GROUP.AI,
    "DOMAIN-SUFFIX,anthropic.com," + GROUP.AI,
    "DOMAIN-SUFFIX,claude.ai," + GROUP.AI,
    "DOMAIN-SUFFIX,perplexity.ai," + GROUP.AI,
    "DOMAIN-SUFFIX,x.ai," + GROUP.AI,
    "DOMAIN-SUFFIX,grok.com," + GROUP.AI,
    "RULE-SET,github_domain," + GROUP.GITHUB,
    "RULE-SET,telegram_domain," + GROUP.TELEGRAM,
    "RULE-SET,telegram_ip," + GROUP.TELEGRAM + ",no-resolve",

    // Google / YouTube
    "RULE-SET,youtube_domain," + GROUP.YOUTUBE,
    "RULE-SET,google_domain," + GROUP.GOOGLE,

    // 海外社交
    "RULE-SET,twitter_domain," + GROUP.SOCIAL,
    "RULE-SET,facebook_domain," + GROUP.SOCIAL,
    "RULE-SET,instagram_domain," + GROUP.SOCIAL,

    // 流媒体
    "RULE-SET,netflix_domain," + GROUP.STREAMING,
    "RULE-SET,spotify_domain," + GROUP.STREAMING,
    "RULE-SET,proxymedia_domain," + GROUP.STREAMING,

    // 厂商服务（默认可直连，可在策略组手动切换）
    "RULE-SET,apple_domain," + GROUP.APPLE,
    "RULE-SET,microsoft_domain," + GROUP.MICROSOFT,

    // 国际域名 / 中国域名
    "RULE-SET,geolocation_non_cn," + GROUP.MAIN,
    "RULE-SET,cn_domain," + GROUP.DIRECT,
    "RULE-SET,cn_ip," + GROUP.DIRECT + ",no-resolve",
  ];

  if (SETTINGS.BLOCK_QUIC) {
    // 可选：阻断 QUIC，迫使 HTTPS 使用 TCP/TLS；仅在 UDP 很差时尝试。
    rules.push("AND,((NETWORK,udp),(DST-PORT,443)),REJECT");
  }

  rules.push("MATCH," + GROUP.FINAL);
  return rules;
}

function buildDns() {
  const cnDoh = [
    "https://223.5.5.5/dns-query",
    "https://1.12.12.12/dns-query",
  ];

  // 明确通过主策略组访问国际 DoH，避免境外域名查询直接落到本地 DNS。
  const globalDoh = [
    "https://1.1.1.1/dns-query#" + GROUP.MAIN,
    "https://8.8.8.8/dns-query#" + GROUP.MAIN,
  ];

  return {
    enable: true,
    listen: "0.0.0.0:1053",
    ipv6: false,
    "cache-algorithm": "arc",
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    "fake-ip-filter-mode": "blacklist",
    "fake-ip-filter": [
      "*.lan",
      "*.local",
      "localhost",
      "+.localdomain",
      "time.*",
      "ntp.*",
      "stun.*",
      "+.msftconnecttest.com",
      "+.msftncsi.com",
    ],
    "use-hosts": true,
    "use-system-hosts": false,
    "prefer-h3": false,
    "respect-rules": true,

    // 用于解析 DoH 服务器自身域名；这里使用 IP，避免启动阶段依赖系统 DNS。
    "default-nameserver": ["223.5.5.5", "119.29.29.29"],

    // 默认国际 DoH 通过代理；国内域名由 policy 指向国内 DoH。
    nameserver: globalDoh,
    "proxy-server-nameserver": cnDoh,
    "direct-nameserver": cnDoh,
    "direct-nameserver-follow-policy": true,

    "nameserver-policy": {
      "rule-set:private_domain": cnDoh,
      "rule-set:cn_domain": cnDoh,
      "rule-set:ai_domain": globalDoh,
      "rule-set:google_domain": globalDoh,
      "rule-set:youtube_domain": globalDoh,
      "rule-set:telegram_domain": globalDoh,
      "rule-set:github_domain": globalDoh,
      "rule-set:twitter_domain": globalDoh,
      "rule-set:facebook_domain": globalDoh,
      "rule-set:instagram_domain": globalDoh,
      "rule-set:netflix_domain": globalDoh,
      "rule-set:spotify_domain": globalDoh,
      "rule-set:proxymedia_domain": globalDoh,
      "rule-set:geolocation_non_cn": globalDoh,
    },
  };
}

function main(config) {
  if (!config || typeof config !== "object") config = {};

  // 不动机场的 proxies / proxy-providers，只重建策略组、规则、规则集和 DNS。
  config["proxy-groups"] = buildGroups();
  config["rule-providers"] = buildRuleProviders();
  config.rules = buildRules();
  config.dns = buildDns();

  // 一些温和的连接参数；FlClash 若有同名 App 设置，最终以 App 为准。
  config["unified-delay"] = true;
  config["tcp-concurrent"] = true;
  config["keep-alive-interval"] = 30;
  config["find-process-mode"] = "off";
  config["log-level"] = "warning";

  return config;
}
