<?php
declare(strict_types=1);

/** Reuse the prototype's presentation without loading its demo data scripts. */
function prototypeHtml(string $page): string
{
    if (!in_array($page, ['login.html', 'trip-list.html'], true)) {
        throw new InvalidArgumentException('Unknown page template');
    }
    $html = file_get_contents(dirname(__DIR__, 2) . '/' . $page);
    if ($html === false) {
        throw new RuntimeException('Page template unavailable');
    }
    return $html;
}

function prototypeStyle(string $page): string
{
    preg_match('/<style>(.*?)<\/style>/s', prototypeHtml($page), $matches);
    return $matches[1] ?? '';
}

function pageHead(string $title, string $template): void
{
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    $safeTitle = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
    echo '<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">';
    echo '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    echo '<title>' . $safeTitle . '</title><link rel="stylesheet" href="assets.php?file=shared-styles.css">';
    echo '<style>' . prototypeStyle($template) . '</style>';
    echo '<style>[hidden]{display:none!important}button:disabled{cursor:wait;opacity:.65}.scope-note{padding:12px 16px;background:var(--color-info);color:var(--color-info-text);border-radius:8px;font-size:13px;line-height:1.8}.page-error{padding:16px;background:var(--color-danger);color:var(--color-danger-text);border-radius:8px;margin-bottom:16px}.backend-footer{text-align:center;padding:24px;font-size:12px;color:var(--color-text-light)}.account-info{font-size:12px;color:#FAF6EC;word-break:break-word}.trip-status-select{font-size:13px;padding:5px;border:1px solid var(--color-border);border-radius:4px}.trip-actions{min-width:126px}.trip-actions button{white-space:nowrap}.form-feedback{margin-top:12px}.conflict-review{font-size:13px;line-height:1.8;margin-top:12px}.conflict-review input{margin-right:8px}.nav-user{display:flex;align-items:center;gap:16px}@media(max-width:650px){.navbar-inner{height:auto;min-height:60px;padding:12px 16px;flex-wrap:wrap;gap:12px}.nav-user{width:100%;justify-content:space-between}.trip-card{grid-template-columns:52px 1fr;gap:12px;padding:16px}.trip-actions{grid-column:1/-1;flex-direction:row;flex-wrap:wrap;justify-content:flex-end}.page-header-inner{gap:12px;flex-wrap:wrap}.login-wrap{grid-template-columns:1fr;max-width:520px;margin:20px}.login-left{display:none}.login-right{padding:28px 24px}}</style>';
    echo '</head>';
}
