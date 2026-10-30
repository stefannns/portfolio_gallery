/* Consolidated CURRENT browser application. Valid JavaScript/JSX-subset source.
 * Rebuild: node check.js --build. No historical authoring version is substituted.
 * External helpers and inline entry code are preserved in their original execution order.
 */
// TEMPLATE_HTML_BASE64: PCFkb2N0eXBlIGh0bWw+PGh0bWwgbGFuZz0iaXQiIGRhdGEtcGxheWFibGUtbG9hZGluZz0idHJ1ZSI+PGhlYWQ+PG1ldGEgY2hhcnNldD0idXRmLTgiPjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+PHRpdGxlPlByZW5kaSBsYSBwYXJydWNjYTwvdGl0bGU+PHN0eWxlID4KQGZvbnQtZmFjZXtmb250LWZhbWlseTpQb3BwaW5zO3NyYzp1cmwoJy4vYXNzZXRzL2ZvbnRzL1BvcHBpbnMtUmVndWxhci53b2ZmMicpIGZvcm1hdCgnd29mZjInKTtmb250LXdlaWdodDo0MDA7Zm9udC1kaXNwbGF5OnN3YXB9CkBmb250LWZhY2V7Zm9udC1mYW1pbHk6UG9wcGlucztzcmM6dXJsKCcuL2Fzc2V0cy9mb250cy9Qb3BwaW5zLUJvbGQud29mZjInKSBmb3JtYXQoJ3dvZmYyJyk7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtZGlzcGxheTpzd2FwfQo6cm9vdHtmb250LWZhbWlseTpQb3BwaW5zLEFyaWFsLHNhbnMtc2VyaWY7Y29sb3I6I2ZmZjtiYWNrZ3JvdW5kOiMyMjI7LS1pbms6I2ZmZjstLXVpOjE7LS1hY2NlbnQ6I2ZmY2Y0Y30KKntib3gtc2l6aW5nOmJvcmRlci1ib3h9aHRtbCxib2R5e21hcmdpbjowO3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7b3ZlcmZsb3c6aGlkZGVufWJvZHl7b3ZlcnNjcm9sbC1iZWhhdmlvcjpub25lfWJ1dHRvbntmb250OmluaGVyaXQ7Y3Vyc29yOnBvaW50ZXI7LXdlYmtpdC10YXAtaGlnaGxpZ2h0LWNvbG9yOnRyYW5zcGFyZW50fWJ1dHRvbjpmb2N1cy12aXNpYmxle291dGxpbmU6M3B4IHNvbGlkICNmZmNkNDU7b3V0bGluZS1vZmZzZXQ6LTVweH1idXR0b246ZGlzYWJsZWR7Y3Vyc29yOmRlZmF1bHR9CiNzdGFnZXtwb3NpdGlvbjpyZWxhdGl2ZTt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO2lzb2xhdGlvbjppc29sYXRlO292ZXJmbG93OmhpZGRlbjt0b3VjaC1hY3Rpb246bWFuaXB1bGF0aW9uO2NvbG9yOnZhcigtLWluayl9Y2FudmFze3Bvc2l0aW9uOmFic29sdXRlO2luc2V0OjA7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtkaXNwbGF5OmJsb2NrfQojcGxheXtwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDowO2JvcmRlcjowO2JhY2tncm91bmQ6bm9uZTt6LWluZGV4OjE7cGFkZGluZzowO3RvdWNoLWFjdGlvbjptYW5pcHVsYXRpb247Y29sb3I6dHJhbnNwYXJlbnR9Ci5tYWtlb3ZlciAjcGxheXt0b3VjaC1hY3Rpb246bm9uZX0KLmh1ZHtwb3NpdGlvbjphYnNvbHV0ZTt0b3A6bWF4KGNhbGMoMzBweCAqIHZhcigtLXVpKSksZW52KHNhZmUtYXJlYS1pbnNldC10b3ApKTtsZWZ0OmNhbGMoMzBweCAqIHZhcigtLXVpKSk7cmlnaHQ6Y2FsYygzMHB4ICogdmFyKC0tdWkpKTtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6ZmxleC1zdGFydDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2Vlbjtwb2ludGVyLWV2ZW50czpub25lO3otaW5kZXg6Mjt0ZXh0LXNoYWRvdzowIDFweCA0cHggIzAwMDk7Zm9udC1zaXplOmNhbGMoMjhweCAqIHZhcigtLXVpKSk7Zm9udC13ZWlnaHQ6NzAwO2xpbmUtaGVpZ2h0OjEuMjU7bGV0dGVyLXNwYWNpbmc6LS42cHg7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zfQouaHVkLmNlbnRlcntqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyfS5odWQgc21hbGx7Zm9udC1zaXplOmNhbGMoMTRweCAqIHZhcigtLXVpKSk7ZGlzcGxheTpibG9jaztsaW5lLWhlaWdodDoxLjQ7bGV0dGVyLXNwYWNpbmc6MDtmb250LXdlaWdodDo0MDA7bWFyZ2luLXRvcDozcHh9Lmh1ZCBzcGFuOmVtcHR5e2Rpc3BsYXk6bm9uZX0KI2d1aWRle3Bvc2l0aW9uOmFic29sdXRlO3otaW5kZXg6MjtsZWZ0OmNhbGMoMzBweCAqIHZhcigtLXVpKSk7cmlnaHQ6Y2FsYygzMHB4ICogdmFyKC0tdWkpKTtib3R0b206bWF4KGNhbGMoNjJweCAqIHZhcigtLXVpKSksZW52KHNhZmUtYXJlYS1pbnNldC1ib3R0b20pKTtmb250LXNpemU6Y2FsYygxOHB4ICogdmFyKC0tdWkpKTtmb250LXdlaWdodDo3MDA7bGluZS1oZWlnaHQ6MS40O3RleHQtYWxpZ246Y2VudGVyO3BvaW50ZXItZXZlbnRzOm5vbmU7dGV4dC1zaGFkb3c6MCAxcHggNHB4ICMwMDBhO2FuaW1hdGlvbjpmbG9hdCAycyBlYXNlLWluLW91dCBpbmZpbml0ZTttYXJnaW46MH0KI2d1aWRlW2hpZGRlbl0sIFtoaWRkZW5de2Rpc3BsYXk6bm9uZSFpbXBvcnRhbnR9aHRtbFtkYXRhLWZlZWQtcHJldmlldz0idHJ1ZSJdICNndWlkZSxodG1sW2RhdGEtZmVlZC1wcmV2aWV3PSJ0cnVlIl0gLmNvbnRyb2xze3Zpc2liaWxpdHk6aGlkZGVufS5jb250cm9sc3twb3NpdGlvbjphYnNvbHV0ZTt6LWluZGV4OjM7bGVmdDpjYWxjKDMwcHggKiB2YXIoLS11aSkpO3JpZ2h0OmNhbGMoMzBweCAqIHZhcigtLXVpKSk7Ym90dG9tOm1heChjYWxjKDUwcHggKiB2YXIoLS11aSkpLGVudihzYWZlLWFyZWEtaW5zZXQtYm90dG9tKSk7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2dhcDoxMnB4O3BvaW50ZXItZXZlbnRzOm5vbmV9Ci5jb250cm9se21pbi1oZWlnaHQ6NDhweDttaW4td2lkdGg6NDhweDtwYWRkaW5nOjEwcHggMjJweDtib3JkZXI6MDtib3JkZXItcmFkaXVzOjMwcHg7YmFja2dyb3VuZDojZmZmO2NvbG9yOiMyMDI1MmI7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxNnB4O2JveC1zaGFkb3c6MCAycHggMTBweCAjMDAwMjtwb2ludGVyLWV2ZW50czphdXRvfS5jb250cm9sOmFjdGl2ZXt0cmFuc2Zvcm06c2NhbGUoLjk3KX0jZGlyZWN0aW9ue21hcmdpbi1sZWZ0OmF1dG87Ym9yZGVyOjFweCBzb2xpZCAjZmZmZmZmODA7YmFja2dyb3VuZDojMjIyODtjb2xvcjojZmZmO2JhY2tkcm9wLWZpbHRlcjpibHVyKDhweCk7cGFkZGluZzoxMHB4IDEzcHg7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4fSNkaXJlY3Rpb24gc3Zne3dpZHRoOjIycHg7aGVpZ2h0OjIycHg7dHJhbnNpdGlvbjp0cmFuc2Zvcm0gLjJzfQojcmVzdWx0e3Bvc2l0aW9uOmFic29sdXRlO3otaW5kZXg6MjtsZWZ0OjI0cHg7cmlnaHQ6MjRweDtib3R0b206Y2FsYygxMjJweCAqIHZhcigtLXVpKSk7dGV4dC1hbGlnbjpjZW50ZXI7cG9pbnRlci1ldmVudHM6bm9uZTtmb250LXNpemU6Y2FsYygyOHB4ICogdmFyKC0tdWkpKTtmb250LXdlaWdodDo3MDA7bGluZS1oZWlnaHQ6MS4yO3RleHQtc2hhZG93OjAgMnB4IDhweCAjMDAwOX0jcmVzdWx0IHNtYWxse2ZvbnQtc2l6ZTpjYWxjKDE4cHggKiB2YXIoLS11aSkpO2ZvbnQtd2VpZ2h0OjQwMDtkaXNwbGF5OmJsb2NrO21hcmdpbi10b3A6OHB4fQojbG9hZGluZ3twb3NpdGlvbjphYnNvbHV0ZTtpbnNldDowO3otaW5kZXg6NjtiYWNrZ3JvdW5kOiMyNTI3MmE7ZGlzcGxheTpncmlkO3BsYWNlLWNvbnRlbnQ6Y2VudGVyO3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6MzBweDtmb250LXNpemU6MThweDtsaW5lLWhlaWdodDoxLjV9I2xvYWRpbmc6YmVmb3Jle2NvbnRlbnQ6Jyc7d2lkdGg6MjhweDtoZWlnaHQ6MjhweDtib3JkZXI6M3B4IHNvbGlkICNmZmZmZmYzNTtib3JkZXItdG9wLWNvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo1MCU7bWFyZ2luOjAgYXV0byAxOHB4O2FuaW1hdGlvbjp0dXJuIC44cyBsaW5lYXIgaW5maW5pdGV9I2xvYWRpbmcuZXJyb3I6YmVmb3Jle2Rpc3BsYXk6bm9uZX0uaGFpci1jYXRjaHstLWluazojMzAyNTFlfS5oYWlyLWNhdGNoIC5odWQsLmhhaXItY2F0Y2ggI2d1aWRlLC5oYWlyLWNhdGNoICNyZXN1bHR7dGV4dC1zaGFkb3c6bm9uZX0uaGFpci1jYXRjaCAjZ3VpZGV7Ym90dG9tOmNhbGMoNzBweCAqIHZhcigtLXVpKSl9LmhhaXItY2F0Y2ggLmh1ZHt0b3A6Y2FsYyg1MHB4ICogdmFyKC0tdWkpKX0uaGFpci1jYXRjaCAjcmVzdWx0e2JvdHRvbTpjYWxjKDE3MHB4ICogdmFyKC0tdWkpKX0KLmhhaXItY2F0Y2ggI2d1aWRle2NvbG9yOiNmZmY7dGV4dC1zaGFkb3c6MCAxcHggNHB4ICMwMDBifS5oYWlyLWNhdGNoIC5odWQgc3Bhbjpub3QoOmVtcHR5KXtiYWNrZ3JvdW5kOiNmZmZlZjdlZDtib3JkZXItcmFkaXVzOjI0cHg7cGFkZGluZzo2cHggMThweH0uaGFpci1zaGF2ZSAjZ3VpZGV7Ym90dG9tOmNhbGMoMTIwcHggKiB2YXIoLS11aSkpfS5tYWtlb3ZlciAuaHVke2ZvbnQtc2l6ZTpjYWxjKDI0cHggKiB2YXIoLS11aSkpfS5tYWtlb3ZlciAuaHVkICNsZWZ0e21heC13aWR0aDo3NSV9I3BhdXNle3Bvc2l0aW9uOmFic29sdXRlO2luc2V0OjA7ei1pbmRleDo3O2JhY2tncm91bmQ6IzE1MTkxYzkwO2Rpc3BsYXk6Z3JpZDtwbGFjZS1jb250ZW50OmNlbnRlcjtiYWNrZHJvcC1maWx0ZXI6Ymx1cig0cHgpfSNyZXN1bWV7Ym9yZGVyOjFweCBzb2xpZCAjZmZmZmZmODA7YmFja2dyb3VuZDojZmZmO2NvbG9yOiMyMjI7Zm9udC1zaXplOjE4cHg7cGFkZGluZzoxNXB4IDI1cHg7Ym9yZGVyLXJhZGl1czozMHB4O21pbi1oZWlnaHQ6NTBweH0KLnNye3Bvc2l0aW9uOmFic29sdXRlO3dpZHRoOjFweDtoZWlnaHQ6MXB4O292ZXJmbG93OmhpZGRlbjtjbGlwOnJlY3QoMCwwLDAsMCl9QGtleWZyYW1lcyBmbG9hdHs1MCV7dHJhbnNmb3JtOnRyYW5zbGF0ZVkoLTVweCl9fUBrZXlmcmFtZXMgdHVybnt0b3t0cmFuc2Zvcm06cm90YXRlKDM2MGRlZyl9fUBtZWRpYShwcmVmZXJzLXJlZHVjZWQtbW90aW9uOnJlZHVjZSl7KiwqOmJlZm9yZXthbmltYXRpb246bm9uZSFpbXBvcnRhbnQ7dHJhbnNpdGlvbjpub25lIWltcG9ydGFudH19Cgo8L3N0eWxlPjxzdHlsZSBkYXRhLWd1aWRlLWNlbnRlcmluZz0iMjAyNjEwMjEiPgovKiBVc2VyIG92ZXJyaWRlIDIwMjYtMTAtMjE6IGZhdm9yIHZpc3VhbCBjZW50ZXIsIG5vdCBhIGZpeGVkIHVwcGVyIGJhbmQuICovCmh0bWw6cm9vdDpyb290OnJvb3QgOmlzKCNyb290LCNnYW1lLCNzdGFnZSk6aXMoI3Jvb3QsI2dhbWUsI3N0YWdlKSBwI2d1aWRle3Bvc2l0aW9uOmZpeGVkIWltcG9ydGFudDt0b3A6MTQlIWltcG9ydGFudDtib3R0b206YXV0byFpbXBvcnRhbnQ7bGVmdDo1MCUhaW1wb3J0YW50O3JpZ2h0OmF1dG8haW1wb3J0YW50O3dpZHRoOm1heC1jb250ZW50IWltcG9ydGFudDttYXgtd2lkdGg6Y2FsYygxMDB2dyAtIDYwcHgpIWltcG9ydGFudDttaW4taGVpZ2h0OjAhaW1wb3J0YW50O21hcmdpbjowIWltcG9ydGFudDt0ZXh0LWFsaWduOmNlbnRlciFpbXBvcnRhbnQ7dHJhbnNsYXRlOi01MCUgLTUwJSFpbXBvcnRhbnQ7dHJhbnNmb3JtOm5vbmUhaW1wb3J0YW50O3BvaW50ZXItZXZlbnRzOm5vbmUhaW1wb3J0YW50O3otaW5kZXg6MjUhaW1wb3J0YW50O292ZXJmbG93LXdyYXA6YW55d2hlcmV9Cgo8L3N0eWxlPgo8c3R5bGUgZGF0YS1iYXRjaDQtcHJldmlldz0iIj4KLyogT25seSB0aGUgZm91ciBuZXdseSBzZWxlY3RlZCBnYW1lcy4gSG9zdCBmcmFtZSwgZ3JhZGllbnRzIGFuZCBsYXVuY2ggcGlsbCBzdGF5IGhvc3Qtb3duZWQuICovCkBrZXlmcmFtZXMgYmF0Y2g0LWd1aWRlLWJyZWF0aGV7MCUsMTAwJXtmaWx0ZXI6b3BhY2l0eSgxKX01MCV7ZmlsdGVyOm9wYWNpdHkoLjY4KX19Cmh0bWw6cm9vdDpyb290IDppcyguY29sb3ItZ3VpZGUscC5mZWVkLWZpcnN0LWFjdGlvbiwuaGludCwjZ3VpZGUpe2FuaW1hdGlvbjpiYXRjaDQtZ3VpZGUtYnJlYXRoZSAyLjRzIGVhc2UtaW4tb3V0IGluZmluaXRlIWltcG9ydGFudH0KaHRtbFtkYXRhLWJhdGNoNC1wYXVzZWRdOnJvb3Q6cm9vdCA6aXMoLmNvbG9yLWd1aWRlLHAuZmVlZC1maXJzdC1hY3Rpb24sLmhpbnQsI2d1aWRlKXthbmltYXRpb24tcGxheS1zdGF0ZTpwYXVzZWQhaW1wb3J0YW50fQpodG1sW2RhdGEtYmF0Y2g0LWdhbWU9IjMzIl06cm9vdDpyb290IHAuZmVlZC1maXJzdC1hY3Rpb257Zm9udC1mYW1pbHk6dmFyKC0tZm9udC1ib2R5LHN5c3RlbS11aSxzYW5zLXNlcmlmKSFpbXBvcnRhbnQ7Zm9udC13ZWlnaHQ6NzAwIWltcG9ydGFudDtjb2xvcjojMTczODRhIWltcG9ydGFudDtiYWNrZ3JvdW5kOiNmZmYhaW1wb3J0YW50O2JvcmRlci1yYWRpdXM6OTk5cHghaW1wb3J0YW50O3BhZGRpbmc6MTBweCAxOHB4IWltcG9ydGFudDtib3gtc2l6aW5nOmJvcmRlci1ib3g7dGV4dC1zaGFkb3c6bm9uZSFpbXBvcnRhbnQ7Ym94LXNoYWRvdzowIDNweCAxMnB4ICMwMDFiMzgzM30KaHRtbFtkYXRhLWJhdGNoNC1nYW1lPSIzMyJdIC5odWR7anVzdGlmeS1jb250ZW50OmNlbnRlcn0KLyogS2VlcCB0aGUgQ1RBIHByZXZpZXcgZm9jdXNlZCBvbiB0aGUgZGVtb25zdHJhdGlvbi4gUmVzdG9yZSB0aGUgSFVEIG9uIGVudHJ5LiAqLwpodG1sW2RhdGEtYmF0Y2g0LWdhbWU9IjMzIl1bZGF0YS1iYXRjaDQtcHJldmlldz0idHJ1ZSJdIC5odWQsCmh0bWxbZGF0YS1iYXRjaDQtZ2FtZT0iOSJdW2RhdGEtYmF0Y2g0LXByZXZpZXc9InRydWUiXSAuY29sb3ItaGVhZGVye3Zpc2liaWxpdHk6aGlkZGVuIWltcG9ydGFudH0KW2RhdGEtbmV0LXByZXZpZXctZ3VpZGVde2Rpc3BsYXk6bm9uZX0KaHRtbFtkYXRhLWJhdGNoNC1wcmV2aWV3PSJ0cnVlIl0gW2RhdGEtbmV0LXByZXZpZXctZ3VpZGVdOm5vdChbaGlkZGVuXSl7ZGlzcGxheTpibG9jaztjb2xvcjojZTRmYWZmO2ZvbnQtc2l6ZToxOHB4O2xpbmUtaGVpZ2h0OjEuMzV9Cmh0bWxbZGF0YS1iYXRjaDQtZ2FtZT0iNDciXVtkYXRhLWJhdGNoNC1wcmV2aWV3PSJ0cnVlIl06cm9vdDpyb290IC5oaW50e3Zpc2liaWxpdHk6dmlzaWJsZSFpbXBvcnRhbnR9Cmh0bWxbZGF0YS1iYXRjaDQtcHJldmlldz0iZmFsc2UiXTpyb290OnJvb3QgLmhpbnRbc3R5bGUqPSJ2aXNpYmlsaXR5OiBoaWRkZW4iXXthbmltYXRpb246bm9uZSFpbXBvcnRhbnR9Cmh0bWw6cm9vdDpyb290IC5jb2xvci1ndWlkZXtwb3NpdGlvbjpmaXhlZDt6LWluZGV4OjI1O3RvcDoyNCU7bGVmdDo1MCU7dHJhbnNsYXRlOi01MCUgLTUwJTt3aWR0aDptYXgtY29udGVudDttYXgtd2lkdGg6Y2FsYygxMDAlIC0gNjBweCk7bWFyZ2luOjA7dGV4dC1hbGlnbjpjZW50ZXI7cG9pbnRlci1ldmVudHM6bm9uZTtjb2xvcjojMzM0MTU1O2ZvbnQ6NzAwIDE4cHgvMS40IHZhcigtLWZvbnQtZGlzcGxheSxzeXN0ZW0tdWksc2Fucy1zZXJpZil9Ci5jb2xvci1ndWlkZVtoaWRkZW5de2Rpc3BsYXk6bm9uZSFpbXBvcnRhbnR9Cmh0bWw6cm9vdDpyb290IC5jb2xvci1oZWFkZXJ7cG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MDtwb2ludGVyLWV2ZW50czpub25lO3BhZGRpbmc6MCFpbXBvcnRhbnQ7ei1pbmRleDoxMCFpbXBvcnRhbnR9Cmh0bWw6cm9vdDpyb290IC5jb2xvci1wYW5lbHtwb3NpdGlvbjpzdGF0aWMhaW1wb3J0YW50O3BhZGRpbmc6MCFpbXBvcnRhbnQ7Ym94LXNoYWRvdzpub25lIWltcG9ydGFudDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50IWltcG9ydGFudDtwb2ludGVyLWV2ZW50czpub25lfQpodG1sOnJvb3Q6cm9vdCAuY29sb3Itcm91bmR7cG9zaXRpb246YWJzb2x1dGU7dG9wOjMwcHg7bGVmdDozMHB4fQpodG1sOnJvb3Q6cm9vdCAuY29sb3Itcm91bmQtZ3JvdXA+ZGl2Om5vdCguY29sb3Itcm91bmQpe2Rpc3BsYXk6bm9uZX0KaHRtbDpyb290OnJvb3QgLmNvbG9yLXRhcmdldC1ncm91cHtwb3NpdGlvbjphYnNvbHV0ZTt0b3A6MzBweDtsZWZ0OmNhbGMoNTAlIC0gMThweCk7dHJhbnNmb3JtOm5vbmU7cG9pbnRlci1ldmVudHM6YXV0b30KaHRtbDpyb290OnJvb3QgLmNvbG9yLXRhcmdldC1zd2F0Y2h7d2lkdGg6MzZweCFpbXBvcnRhbnQ7aGVpZ2h0OjM2cHghaW1wb3J0YW50fQpodG1sOnJvb3Q6cm9vdCAuY29sb3ItcmVzZXR7cG9zaXRpb246Zml4ZWQ7Ym90dG9tOjUwcHg7cmlnaHQ6MzBweH0KaHRtbDpyb290OnJvb3QgLmNvbG9yLW1hdGNoLWh1ZHtwb3NpdGlvbjpmaXhlZDt0b3A6MzBweDtyaWdodDozMHB4fQpodG1sOnJvb3Q6cm9vdCAuY29sb3ItcHJvZ3Jlc3Mtcm93e3Bvc2l0aW9uOmFic29sdXRlO3RvcDo4MnB4O2xlZnQ6MzBweDtyaWdodDozMHB4O3BvaW50ZXItZXZlbnRzOm5vbmV9Cmh0bWw6cm9vdDpyb290IC5jb2xvci1ib3dsLXdyYXB7cG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MDtwYWRkaW5nOjAhaW1wb3J0YW50O3BvaW50ZXItZXZlbnRzOm5vbmV9Cmh0bWw6cm9vdDpyb290IC5jb2xvci1taXgtYm93bHtwb3NpdGlvbjphYnNvbHV0ZSFpbXBvcnRhbnQ7bGVmdDo1MCUhaW1wb3J0YW50O3RvcDo0NyUhaW1wb3J0YW50O3RyYW5zbGF0ZTotNTAlIC01MCU7dHJhbnNmb3JtOm5vbmUhaW1wb3J0YW50O21pbi13aWR0aDowIWltcG9ydGFudDtib3gtc2l6aW5nOmJvcmRlci1ib3ghaW1wb3J0YW50O3dpZHRoOm1pbig2MnZ3LDM1dmgpIWltcG9ydGFudDtoZWlnaHQ6YXV0bztwb2ludGVyLWV2ZW50czphdXRvfQpodG1sOnJvb3Q6cm9vdCAuY29sb3ItbWl4LWJvd2w+ZGl2Om5vdCguY29sb3ItcHJldmlldy1wYWludCl7ZGlzcGxheTpub25lfQpodG1sOnJvb3Q6cm9vdCAuY29sb3ItdHViZXN7cG9zaXRpb246YWJzb2x1dGU7bGVmdDozMHB4O3JpZ2h0OjMwcHg7dG9wOjY2JTtoZWlnaHQ6MTMlO3BhZGRpbmc6MCFpbXBvcnRhbnQ7YmFja2dyb3VuZDp0cmFuc3BhcmVudCFpbXBvcnRhbnQ7Ym94LXNoYWRvdzpub25lIWltcG9ydGFudDtwb2ludGVyLWV2ZW50czphdXRvfQpodG1sOnJvb3Q6cm9vdCAuY29sb3ItdHViZXM+ZGl2e2hlaWdodDoxMDAlIWltcG9ydGFudH0KaHRtbFtkYXRhLWJhdGNoNC1wcmV2aWV3PSJ0cnVlIl0gLmNvbG9yLXJlc2V0e3Zpc2liaWxpdHk6aGlkZGVuO3BvaW50ZXItZXZlbnRzOm5vbmV9Ci5jb2xvci1wcmV2aWV3LXBhaW50e3Bvc2l0aW9uOmFic29sdXRlO2luc2V0OjglO2JvcmRlci1yYWRpdXM6NTAlO3BvaW50ZXItZXZlbnRzOm5vbmU7ZGlzcGxheTpub25lO2JhY2tncm91bmQ6cmFkaWFsLWdyYWRpZW50KGVsbGlwc2UgYXQgMzUlIDM1JSwjZmJhNmIwIDAlLCNjZjYzN2IgMjYlLCM2YjVkY2MgNjQlLCMzYjRhOWYgMTAwJSk7Ym94LXNoYWRvdzppbnNldCAwIDhweCAxOHB4ICNmZmZmZmY0NX0KLmNvbG9yLXByZXZpZXctdHViZXtwb3NpdGlvbjphYnNvbHV0ZSFpbXBvcnRhbnQ7dG9wOjA7bGVmdDowO3dpZHRoOnZhcigtLXBhaW50LXR3KSFpbXBvcnRhbnQ7aGVpZ2h0OnZhcigtLXBhaW50LXRoKSFpbXBvcnRhbnQ7Ym94LXNpemluZzpib3JkZXItYm94O3BvaW50ZXItZXZlbnRzOm5vbmU7ei1pbmRleDoxNTtkaXNwbGF5Om5vbmU7Ym9yZGVyOjNweCBzb2xpZCAjMGYxNzJhYjg7Ym9yZGVyLXJhZGl1czoxNHB4IDE0cHggOXB4IDlweDtiYWNrZ3JvdW5kOmxpbmVhci1ncmFkaWVudCgjZmY4Nzk0LCNkNjI4MzkpO2ZpbHRlcjpkcm9wLXNoYWRvdygwIDRweCA2cHggIzAwMDMpfQpodG1sW2RhdGEtYmF0Y2g0LXByZXZpZXc9InRydWUiXSAuY29sb3ItcHJldmlldy1wYWludHtkaXNwbGF5OmJsb2NrO2FuaW1hdGlvbjpwYWludC1taXgtcHJldmlldyAzLjZzIGVhc2UtaW4tb3V0IGluZmluaXRlfQpodG1sW2RhdGEtYmF0Y2g0LXByZXZpZXc9InRydWUiXSAuY29sb3ItcHJldmlldy10dWJle2Rpc3BsYXk6YmxvY2s7YW5pbWF0aW9uOnBhaW50LXR1YmUtcHJldmlldyAzLjZzIGVhc2UtaW4tb3V0IGluZmluaXRlfQpAa2V5ZnJhbWVzIHBhaW50LW1peC1wcmV2aWV3ezAlLDE4JSwxMDAle29wYWNpdHk6MDtzY2FsZTouMzV9NDYlLDcyJXtvcGFjaXR5OjE7c2NhbGU6MX04NiV7b3BhY2l0eTouMjtzY2FsZToxfX0KQGtleWZyYW1lcyBwYWludC10dWJlLXByZXZpZXd7MCUsNyV7b3BhY2l0eTowO3RyYW5zZm9ybTp0cmFuc2xhdGUoY2FsYyh2YXIoLS1wYWludC1zeCkgLSA1MCUpLGNhbGModmFyKC0tcGFpbnQtc3kpIC0gNTAlKSkgcm90YXRlKDApfTE0JXtvcGFjaXR5OjF9NDAlLDYyJXtvcGFjaXR5OjE7dHJhbnNmb3JtOnRyYW5zbGF0ZShjYWxjKHZhcigtLXBhaW50LWV4KSAtIDUwJSksY2FsYyh2YXIoLS1wYWludC1leSkgLSA1MCUpKSByb3RhdGUoLTIyZGVnKX03OCUsMTAwJXtvcGFjaXR5OjA7dHJhbnNmb3JtOnRyYW5zbGF0ZShjYWxjKHZhcigtLXBhaW50LWV4KSAtIDUwJSksY2FsYyh2YXIoLS1wYWludC1leSkgLSA1MCUpKSByb3RhdGUoLTIyZGVnKX19Cmh0bWxbZGF0YS1iYXRjaDQtcGF1c2VkXSA6aXMoLmNvbG9yLXByZXZpZXctcGFpbnQsLmNvbG9yLXByZXZpZXctdHViZSl7YW5pbWF0aW9uLXBsYXktc3RhdGU6cGF1c2VkIWltcG9ydGFudH0KaHRtbDpyb290OnJvb3QgI3N0YWdlICNndWlkZXt2aXNpYmlsaXR5OnZpc2libGUhaW1wb3J0YW50O2NvbG9yOiMzMDI1MWUhaW1wb3J0YW50O3RleHQtc2hhZG93Om5vbmUhaW1wb3J0YW50fQpAbWVkaWEocHJlZmVycy1yZWR1Y2VkLW1vdGlvbjpyZWR1Y2Upe2h0bWw6cm9vdDpyb290IDppcyguY29sb3ItZ3VpZGUscC5mZWVkLWZpcnN0LWFjdGlvbiwuaGludCwjZ3VpZGUpe2FuaW1hdGlvbjpub25lIWltcG9ydGFudH0uY29sb3ItcHJldmlldy10dWJle2Rpc3BsYXk6bm9uZSFpbXBvcnRhbnR9LmNvbG9yLXByZXZpZXctcGFpbnR7YW5pbWF0aW9uOm5vbmUhaW1wb3J0YW50O29wYWNpdHk6LjchaW1wb3J0YW50O3NjYWxlOjEhaW1wb3J0YW50fX0KCjwvc3R5bGU+CgoKPHN0eWxlIGRhdGEtaXRhbGlhbi1sYXlvdXQ9IiI+Ci8qIEl0YWxpYW4gY29weSBrZWVwcyB0aGUgYXBwcm92ZWQgcm9sZSBzaXplcyBhbmQgbWF5IHdyYXAgaW5zdGVhZCBvZiBjbGlwcGluZy4gKi8KaHRtbFtsYW5nPSJpdCJdIDppcygubWVldGluZy1ndWlkZSwuZmVlZC1maXJzdC1hY3Rpb24sLm1lbG9keS1ndWlkZSwucGFydGljbGUtZ3VpZGUsLmRpdmUtZ3VpZGUsLnNhbmRib3gtZ3VpZGUsLmtvaS1ndWlkZSwudWktZ3VpZGUsLmJlYWQtZ3VpZGUsLmNvbG9yaW5nLWd1aWRlLC5sb29rLWd1aWRlLC50aW1lLXByaW50LWd1aWRlKXt3aGl0ZS1zcGFjZTpub3JtYWw7b3ZlcmZsb3ctd3JhcDpub3JtYWw7d29yZC1icmVhazpub3JtYWw7bGluZS1oZWlnaHQ6MS40fQpodG1sW2xhbmc9Iml0Il0gOmlzKGJ1dHRvbiwuYnRuLC5idG4tbmVvbil7b3ZlcmZsb3ctd3JhcDpub3JtYWw7d29yZC1icmVhazpub3JtYWx9Cmh0bWxbbGFuZz0iaXQiXSAubWVsb2R5LWNvbnRyb2xzIGJ1dHRvbntmb250LXNpemU6MThweDtwYWRkaW5nLWlubGluZToxMnB4fQpodG1sW2xhbmc9Iml0Il0gLm1lZXRpbmctc2FuZC1iYWxsLWNvdW50e2dhcDo2cHghaW1wb3J0YW50fQpodG1sW2xhbmc9Iml0Il0gI3Blb3BsZS1kaWFsb2cgZmllbGRzZXQgbGFiZWx7bWluLXdpZHRoOjB9Cmh0bWxbbGFuZz0iaXQiXSAjcGVvcGxlLWRpYWxvZyBpbnB1dHttYXgtd2lkdGg6MTAwJTttaW4td2lkdGg6MH0KCjwvc3R5bGU+CjwvaGVhZD48Ym9keT48bWFpbiBpZD0ic3RhZ2UiPjxjYW52YXMgaWQ9ImNhbnZhcyIgYXJpYS1oaWRkZW49InRydWUiPjwvY2FudmFzPjxidXR0b24gaWQ9InBsYXkiIGFyaWEtbGFiZWw9IlBsYXkiPjwvYnV0dG9uPjxkaXYgaWQ9Imh1ZCIgY2xhc3M9Imh1ZCIgYXJpYS1oaWRkZW49InRydWUiPjxzcGFuIGlkPSJsZWZ0Ij48L3NwYW4+PHNwYW4gaWQ9InJpZ2h0Ij48L3NwYW4+PC9kaXY+PHAgaWQ9Imd1aWRlIj48L3A+PGRpdiBpZD0icmVzdWx0IiBoaWRkZW4+PHNwYW4gaWQ9InJlc3VsdFRpdGxlIj48L3NwYW4+PHNtYWxsIGlkPSJyZXN1bHRTdWIiPjwvc21hbGw+PC9kaXY+PGRpdiBjbGFzcz0iY29udHJvbHMiPjxidXR0b24gaWQ9InJldHJ5IiBjbGFzcz0iY29udHJvbCIgaGlkZGVuPlJpcHJvdmE8L2J1dHRvbj48YnV0dG9uIGlkPSJkaXJlY3Rpb24iIGNsYXNzPSJjb250cm9sIiBoaWRkZW4gYXJpYS1sYWJlbD0iQ2FtYmlhIGRpcmV6aW9uZSI+PHN2ZyB2aWV3Qm94PSIwIDAgMjQgMjQiIGZpbGw9Im5vbmUiIHN0cm9rZT0iY3VycmVudENvbG9yIiBzdHJva2Utd2lkdGg9IjIiIGFyaWEtaGlkZGVuPSJ0cnVlIj48cGF0aCBkPSJNNiAxN1Y0bS0zIDMgMy0zIDMgM205IDB2MTNtLTMtMyAzIDMgMy0zIi8+PC9zdmc+PHNwYW4+RGlyZWN0aW9uPC9zcGFuPjwvYnV0dG9uPjwvZGl2PjxkaXYgaWQ9InBhdXNlIiBoaWRkZW4+PGJ1dHRvbiBpZD0icmVzdW1lIj5Ub2NjYSBwZXIgcmlwcmVuZGVyZTwvYnV0dG9uPjwvZGl2PjxkaXYgaWQ9ImxvYWRpbmciIHJvbGU9InN0YXR1cyI+Q2FyaWNhbWVudG/igKY8L2Rpdj48ZGl2IGlkPSJzdGF0dXMiIHJvbGU9InN0YXR1cyIgYXJpYS1saXZlPSJwb2xpdGUiIGNsYXNzPSJzciI+PC9kaXY+PC9tYWluPjwhLS0gQ1RBX0JSRUFUSElOR19TVEFSVCAtLT4KCjwhLS0gQ1RBX0JSRUFUSElOR19FTkQgLS0+CjxzY3JpcHQgc3JjPSIuL2J1bmRsZS5qcyI+PC9zY3JpcHQ+CjwvYm9keT48L2h0bWw+Cg==

;/* Current runtime segment: game-data.it.js */
window.GAME_SPEC={
  "id": "hair-catch",
  "title": "Prendi la parrucca",
  "settings": {
    "fallSpeed": 900,
    "wigFitFactor": 2.05,
    "startWigIndex": 0,
    "wigAspects": [
      1.165,
      1.134,
      0.709,
      1.115,
      0.884
    ],
    "wigAnchors": [
      0.39,
      0.39,
      0.595,
      0.502,
      0.413
    ],
    "wigHoleCX": [
      0.408,
      0.47,
      0.478,
      0.468,
      0.449
    ],
    "sizes": [
      0.808,
      0.837,
      0.783,
      0.995,
      0.787
    ],
    "offsetX": [
      -29,
      3,
      1,
      11,
      -15
    ],
    "offsetY": [
      -17,
      -7,
      -10,
      -10,
      -76
    ],
    "rotations": [
      0,
      0,
      0,
      0,
      0
    ],
    "flips": [
      false,
      false,
      false,
      false,
      false
    ],
    "face": {
      "x": -10,
      "width": 240,
      "targetY": 156,
      "rotation": 0
    }
  },
  "assets": {
    "person": "PERSON",
    "background": "BACKGROUND",
    "hair": [
      "HAIR_0",
      "HAIR_1",
      "HAIR_2",
      "HAIR_3",
      "HAIR_4"
    ]
  },
  "person": {
    "position": {
      "x": 0,
      "y": -207
    },
    "size": {
      "x": 720,
      "y": 866
    },
    "pivot": {
      "x": 0.5,
      "y": 0.5
    },
    "scale": {
      "x": 1,
      "y": 1,
      "z": 1
    }
  },
  "audio": {}
};

;

;/* Current runtime segment: engine.it.js */
(function(root){
  'use strict';
  class HairCatch{
    constructor(settings,rng=Math.random){this.s=settings;this.rng=rng;this.selected=-1;this.reset();}
    reset(){this.state='falling';this.started=false;this.score=null;this.scoreAge=0;this.drop();}
    geometry(index=this.selected){
      const s=this.s,f=s.face,width=Math.max(280,Math.min(1600,f.width*s.wigFitFactor*s.sizes[index]));
      const height=width/s.wigAspects[index],angle=(f.rotation+s.rotations[index])*Math.PI/180;
      const cx=s.flips[index]?1-s.wigHoleCX[index]:s.wigHoleCX[index];
      const dx=(cx-.5)*width,dy=(.5-s.wigAnchors[index])*height;
      const shift=s.offsetY[index]*f.width/273;
      return{width,height,angle,flip:s.flips[index],x:f.x+s.offsetX[index]*f.width/273-(dx*Math.cos(angle)-dy*Math.sin(angle)),wearY:dx*Math.sin(angle)+dy*Math.cos(angle),targetY:f.targetY+shift};
    }
    drop(){let n=Math.floor(this.rng()*5);if(n===this.selected)n=(n+1)%5;this.selected=n;const g=this.geometry();this.y=640+g.height/2;this.state='falling';this.score=null;this.scoreAge=0;}
    tick(dt){if(this.state==='falling'){this.y-=this.s.fallSpeed*dt;if(this.y<-640-this.geometry().height/2)this.drop();}else{this.scoreAge+=dt;if(this.scoreAge>=2.8)this.drop();}}
    tap(){if(this.state==='stopped'){this.drop();return{next:true};}this.started=true;const g=this.geometry(),distance=Math.abs(this.y+g.wearY-g.targetY);this.score=distance<=5?100:Math.max(0,(1-distance/500)*100);this.scoreAge=0;this.state='stopped';return{score:this.score,distance};}
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={HairCatch};else root.HairCatch=HairCatch;
})(typeof window!=='undefined'?window:globalThis);

;

;/* Current runtime segment: game.it.js */
window.createGame=function(R){
 const {ctx:c,spec:s}=R,a=s.assets,m=new HairCatch(s.settings);let feedback='',previewAge=0;
 function reset(){m.reset();feedback='';previewAge=0;R.guide(R.config.texts.find(t=>t.id==='GUIDE')?.value||"Tocca per fermare la parrucca");R.hud('','',true);R.setAction("Ferma la parrucca che cade");R.result('');}
 return{reset,previewUpdate(dt){previewAge+=dt;},state:()=>({state:m.state,selected:m.selected,y:m.y,score:m.score,started:m.started}),isPlaying:()=>m.started,
 action(){const hit=m.tap();if(hit.score!==undefined){feedback=hit.score>=98?"Perfetta!":hit.score>=70?"Quasi!":"Prova il prossimo look";R.tone(hit.score>70?'good':'bad');R.announce((hit.score).toLocaleString("it-IT",{minimumFractionDigits:2,maximumFractionDigits:2})+" per cento. "+feedback);}R.guide('',false);},
 update(dt){m.tick(dt);if(m.state==='stopped'){const p=R.reduced?1:R.ease(Math.min(1,m.scoreAge));R.hud((m.score*p).toLocaleString("it-IT",{minimumFractionDigits:2,maximumFractionDigits:2})+'%','',true);}else R.hud('','',true);},
 draw(t){
  c.fillStyle='#f8d14f';c.fillRect(0,0,R.w,R.h);R.photo(a.background);
  const demo=window.PlayableBatch4Preview?.active;
  // Preview-only poses: the live drop, timing and score stay untouched.
  const index=demo?(window.PlayableBatch4Preview.reduced?0:Math.floor(previewAge*1000/window.PlayablePreviewModels.hairCycleMs)%2):m.selected;
  const g=m.geometry(index),pose=demo?window.PlayablePreviewModels.hairPose(previewAge*1000,g,window.PlayableBatch4Preview.reduced):{y:m.y,alpha:1};
  const k=Math.max(R.w/720,R.h/1280);
  c.save();if(demo){c.beginPath();c.rect(0,R.h*.14+28,R.w,R.h);c.clip();}c.translate(R.w/2,R.h/2);c.scale(k,k);R.sprite(a.person,0,207,720,866);
  c.save();c.translate(g.x,-pose.y);c.rotate(-g.angle);if(g.flip)c.scale(-1,1);
  R.sprite(a.hair[index],0,0,g.width,g.height,0,pose.alpha);c.restore();c.restore();
  if(!demo&&m.state==='stopped'){c.save();c.fillStyle='#fff';c.shadowColor='#000';c.shadowBlur=5;c.textAlign='center';c.font=`700 ${18*Math.min(R.w/390,R.h/598)}px Poppins`;c.fillText(feedback,R.w/2,Math.min(R.h-115,R.h*.78));c.restore();}
 }
 };
};

;

;/* Current runtime segment: runtime.it.js */
(function(){'use strict';
const el=id=>document.getElementById(id),canvas=el('canvas'),ctx=canvas.getContext('2d',{alpha:false}),spec=window.GAME_SPEC;
const images={},config={},hosted=new URLSearchParams(location.search).get('host')==='fyp'||new URLSearchParams(location.search).get('feedReview')==='1'||!!document.querySelector('script[src*="playable-batch/review-host.js"]');let running=false,hidden=false,hostActive=!hosted,paused=false,last=0,age=0,app;
document.documentElement.dataset.feedPreview=String(hosted&&!hostActive);
const soundNodes=new Set(),voices=new Set();let ac;
const R=window.Playable={spec,images,ctx,canvas,w:390,h:598,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,config,
 clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),mix:(a,b,p)=>a+(b-a)*p,ease:p=>1-Math.pow(1-p,3),
 cover(id){const im=images[id],f=spec.photoFraming,s=Math.max(R.w/im.width,R.h/im.height)*(f?.zoom||1),w=im.width*s,h=im.height*s;let y=f?R.h*f.screenY-h*f.y:(R.h-h)/2;if(f?.topLandmark!==undefined)y=Math.max(y,R.h*f.minTop-h*f.topLandmark);return{x:f?R.clamp(R.w*.5-w*f.x,R.w-w,0):(R.w-w)/2,y:R.clamp(y,R.h-h,0),w,h};},
 photo(id,alpha=1){const p=R.cover(id);ctx.save();ctx.globalAlpha=alpha;ctx.drawImage(images[id],p.x,p.y,p.w,p.h);ctx.restore();return p;},
 point(id,p){const b=R.cover(id);return{x:b.x+b.w*p.x,y:b.y+b.h*p.y};},
 sprite(id,x,y,w,h,rotation=0,alpha=1,anchor={x:.5,y:.5}){const im=images[id];if(!im||!Number.isFinite(x+y+w))return;h=h??w*im.height/im.width;ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.globalAlpha=alpha;ctx.drawImage(im,-w*anchor.x,-h*anchor.y,w,h);ctx.restore();},
 frame(ids,t,duration,x,y,w,h,loop=false){if(t<0||(!loop&&t>=duration))return;if(loop&&R.reduced)t=duration*.5;const n=Math.min(ids.length-1,Math.floor((loop?t%duration:t)/duration*ids.length));R.sprite(ids[n],x,y,w,h);},
 hud(left='',right='',center=false){el('left').textContent=left;el('right').textContent=right;el('hud').classList.toggle('center',center);},
 guide(text,show=true){el('guide').textContent=text;el('guide').hidden=!show;},
 result(title,sub=''){el('resultTitle').textContent=title;el('resultSub').textContent=sub;el('result').hidden=!title;el('retry').hidden=!title;},
 announce(text){el('status').textContent=text;},
 unlock(){try{ac??=new(window.AudioContext||window.webkitAudioContext)();if(ac.state==='suspended')ac.resume().catch(()=>{});}catch{}},
 tone(kind='good'){if(!ac||ac.state!=='running')return;const now=ac.currentTime,o=ac.createOscillator(),g=ac.createGain();o.type=kind==='bad'?'triangle':'sine';o.frequency.setValueAtTime(kind==='bad'?230:650,now);o.frequency.exponentialRampToValueAtTime(kind==='bad'?130:900,now+.12);g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(.09,now+.008);g.gain.exponentialRampToValueAtTime(.0001,now+.17);o.connect(g);g.connect(ac.destination);o.start();o.stop(now+.19);voices.add(o);o.onended=()=>{voices.delete(o);o.disconnect();g.disconnect();};},
 sound(key,volume=.5,loop=false){const path=spec.audio[key];if(!path)return null;const a=new Audio(path);a.volume=volume;a.loop=loop;soundNodes.add(a);a.addEventListener('ended',()=>soundNodes.delete(a),{once:true});a.play().catch(()=>{soundNodes.delete(a);});return a;},
 stop(a){if(a){a.pause();a.currentTime=0;soundNodes.delete(a);}},
 silence(){for(const a of soundNodes)R.stop(a);for(const o of voices){try{o.stop();}catch{}}voices.clear();},
 setAction(label){el('play').setAttribute('aria-label',label);},
 releaseInput(){endPointer();},
 setDirection(show,fn){el('direction').hidden=!show;el('direction').onclick=()=>{if(paused||!hostActive)return;R.unlock();fn();};},
 debug:()=>({state:app?.state?.(),paused,hostActive,hidden,loaded:Object.keys(images).length,sounds:soundNodes.size})};
function size(){const b=canvas.getBoundingClientRect();R.w=b.width;R.h=b.height;const d=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(b.width*d);canvas.height=Math.round(b.height*d);ctx.setTransform(d,0,0,d,0,0);document.documentElement.style.setProperty('--ui',Math.min(b.width/390,b.height/598));app?.resize?.();}
function reset(){endPointer();R.silence();paused=false;el('pause').hidden=true;R.result('');el('direction').hidden=true;app.reset();R.announce("Pronto");if(running)app.draw(0);last=0;}
function point(e){const b=canvas.getBoundingClientRect();return{x:e.clientX-b.left,y:e.clientY-b.top};}
function canInput(){return running&&!paused&&hostActive&&!hidden;}
function action(e){if(!canInput()||app.inputMode==='drag')return;R.unlock();const p=e?point(e):{x:R.w/2,y:R.h*.70};app.action(p);}
let down=null;
function endPointer(){const d=down;down=null;app?.pointerEnd?.();if(d&&el('play').hasPointerCapture?.(d.id))el('play').releasePointerCapture(d.id);}
el('play').addEventListener('pointerdown',e=>{if(e.isPrimary===false||e.button!==0||!canInput())return;if(app.inputMode==='drag'){R.unlock();if(!app.pointerStart(point(e)))return;e.preventDefault();down={id:e.pointerId};el('play').setPointerCapture(e.pointerId);return;}down={id:e.pointerId,x:e.clientX,y:e.clientY};});
el('play').addEventListener('pointermove',e=>{if(app?.inputMode!=='drag'||!down||e.pointerId!==down.id)return;if(!canInput()||e.buttons===0){endPointer();return;}e.preventDefault();app.pointerMove(point(e));});
el('play').addEventListener('pointercancel',e=>{if(down&&e.pointerId===down.id)endPointer();});
el('play').addEventListener('lostpointercapture',e=>{if(down&&e.pointerId===down.id)endPointer();});
el('play').addEventListener('pointerup',e=>{if(!down||e.pointerId!==down.id)return;const d=down;if(app.inputMode==='drag'){endPointer();return;}down=null;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>18)return;action(e);});
el('play').addEventListener('click',e=>{if(e.detail===0)action();});
el('play').addEventListener('keydown',e=>{if(!canInput()||!app.keyStroke||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();R.unlock();app.keyStroke(e.key);});
el('retry').onclick=()=>{R.unlock();reset();};el('resume').onclick=()=>{R.unlock();paused=false;el('pause').hidden=true;app.resume?.();last=0;};
function pause(){endPointer();R.silence();app?.pause?.();if(running&&app?.isPlaying?.()){paused=true;el('pause').hidden=false;}}
document.addEventListener('visibilitychange',()=>{hidden=document.hidden;if(hidden)pause();last=0;});
window.addEventListener('blur',pause);window.addEventListener('resize',size);
// Only the parent frame can control activity; never accept commands from sibling windows.
window.addEventListener('message',e=>{if(e.source!==parent||parent===window)return;const d=e.data;if(d?.type==='playable-active'&&typeof d.active==='boolean'){hostActive=d.active;document.documentElement.dataset.feedPreview=String(!hostActive);if(!hostActive&&running){pause();reset();}last=0;}});
function palette(){if(parent===window)return;const c=document.createElement('canvas');c.width=32;c.height=48;const x=c.getContext('2d');x.drawImage(canvas,0,0,32,48);try{parent.postMessage({type:'playable-palette',top:Array.from(x.getImageData(0,0,32,12).data),bottom:Array.from(x.getImageData(0,36,32,12).data)},location.origin);}catch{}}
function loop(t){requestAnimationFrame(loop);if(!running||hidden||paused){last=0;return;}const dt=last?Math.min(.05,(t-last)/1000):0;last=t;age+=dt;if(hostActive)app.update(dt);else app.previewUpdate?.(dt);app.draw(age);const state=app.state?.().state;if(el('stage').dataset.state!==state)el('stage').dataset.state=state;}
async function boot(){try{const c=await fetch("./game.config.json?l10n=6382dd330332",{cache:'no-store'}).then(r=>{if(!r.ok)throw Error("Impossibile caricare la configurazione");return r.json();});Object.assign(config,c);for(const t of c.tweaks||[]){if(typeof t.value==='number'&&Number.isFinite(t.value))spec.settings[t.id]=R.clamp(t.value,t.min??-Infinity,t.max??Infinity);}await Promise.all(c.images.map(async slot=>{if(!slot.path||/^(https?:|data:)/.test(slot.path))throw Error("L’immagine deve usare un percorso locale: "+slot.id);const im=new Image();im.src=slot.path;await im.decode();images[slot.id]=im;}));await document.fonts.ready;document.title=spec.title;el('stage').className=spec.id;app=window.createGame(R);size();reset();running=true;el('loading').hidden=true;app.draw(0);document.documentElement.dataset.playableLoading='false';palette();requestAnimationFrame(loop);}catch(e){el('loading').classList.add('error');el('loading').textContent="Impossibile caricare il gioco. "+e.message;console.error(e);}}
boot();
})();

;

;/* Current runtime segment: inline-4 */

/* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
(()=>{
 const selectors=["p#guide"],copy=new Set(["Tocca per fermare la parrucca"].map(s=>s.replace(/\s+/g,' ').trim().toLowerCase()));
 const motion=window.matchMedia('(prefers-reduced-motion: reduce)'),running=new Map();let queued=false,visible=true;
 const action=/^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;
 function scan(){
  queued=false;for(const [el,a]of running)if(!el.isConnected){a.cancel();running.delete(el);}
  if(motion.matches){for(const a of running.values())a.cancel();running.clear();return;}
  const targets=new Set();for(const selector of selectors){try{document.querySelectorAll(selector).forEach(el=>targets.add(el));}catch{}}
  for(const el of document.querySelectorAll('p,span,div,label,text')){
   if(el.children.length||el.closest('button,a,input,select,textarea,[role="button"]'))continue;
   const text=(el.textContent||'').replace(/\s+/g,' ').trim();
   if(text.length>=5&&text.length<=140&&(copy.has(text.toLowerCase())||(!selectors.length&&action.test(text))))targets.add(el);
  }
  for(const el of targets){
   if(running.has(el)||typeof el.animate!=='function')continue;
   if([...targets].some(child=>child!==el&&el.contains(child)))continue;
   const style=getComputedStyle(el);if(/breath/i.test(style.animationName))continue;
   const base=style.filter.replace(/opacity\([^)]*\)/g,'').replace(/^none$/,'').trim(),filter=v=>(base?base+' ':'')+'opacity('+v+')';
   const a=el.animate([{filter:filter(1)},{filter:filter(.65)},{filter:filter(1)}],{duration:2400,iterations:Infinity,easing:'ease-in-out'});running.set(el,a);if(document.hidden||!visible)a.pause();
  }
 }
 const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(scan);}};
 const pause=()=>{for(const a of running.values())document.hidden||!visible?a.pause():a.play();};
 const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
 const intersection=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);pause();}):null;
 if(document.body)intersection?.observe(document.body);else document.addEventListener('DOMContentLoaded',()=>intersection?.observe(document.body),{once:true});
 document.addEventListener('visibilitychange',pause);motion.addEventListener?.('change',schedule);schedule();
 window.addEventListener('pagehide',()=>{observer.disconnect();intersection?.disconnect();for(const a of running.values())a.cancel();running.clear();},{once:true});
})();


;

;/* Current runtime segment: preview-models.it.js */
/* Read-only demonstration poses. No scoring, timers, input or game-state writes. */
(function(root){
 'use strict';
 const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
 function netPose(ms,width,height,columns,rows){
  const phase=(Math.max(0,ms)%3600)/3600;
  const pull=Math.sin(Math.PI*clamp((phase-.12)/.7))**2;
  return{row:Math.round(rows*.57),col:Math.round(columns*.45),dx:Math.min(48,width*.12)*pull,dy:Math.min(32,height*.055)*pull,ratio:pull*.8};
 }
 function heatPose(ms,width,height,radius){
  const t=Math.max(0,ms)/1350,reach=Math.min(radius*.45,width*.2,height*.17);
  return{x:width/2+Math.cos(t)*reach,y:height/2+Math.sin(t*1.37)*reach*.72};
 }
 const hairCycleMs=2400;
 function hairPose(ms,geometry,reduced=false){
  const phase=(Math.max(0,ms)%hairCycleMs)/hairCycleMs;
  const target=geometry.targetY-geometry.wearY;
  if(reduced)return{y:target,alpha:1};
  return{y:640+geometry.height/2-(1280+geometry.height)*phase,alpha:1};
 }
 const api=Object.freeze({netPose,heatPose,hairPose,hairCycleMs});
 if(typeof module==='object'&&module.exports)module.exports=api;else root.PlayablePreviewModels=api;
})(typeof window==='object'?window:globalThis);

;

;/* Current runtime segment: preview-controller.it.js */
var __PLAYABLE_TEMPLATE_SCRIPT_6=(()=>{var node=document.createElement("script");for(var entry of Object.entries({"data-batch4-preview":"","defer":"","data-game":"77","src":"./preview-controller.it.js?l10n=6382dd330332&v=b487e18c9adf"}))node.setAttribute(entry[0],entry[1]);return node;})();
/* Game-specific FYP presentation. Never sends or simulates gameplay input. */
(()=>{
 'use strict';
 const game=Number(__PLAYABLE_TEMPLATE_SCRIPT_6?.dataset.game),html=document.documentElement;
 const hosted=!!document.querySelector('script[src*="playable-batch/review-host.js"]')||new URLSearchParams(location.search).get('host')==='fyp'||new URLSearchParams(location.search).get('feedReview')==='1';
 const media=matchMedia('(prefers-reduced-motion: reduce)');
 let preview=hosted,origin=performance.now(),used=false,guide=null,paintApp=null;
 html.dataset.batch4Game=String(game);
 function sync(){html.dataset.batch4Preview=String(preview);html.toggleAttribute('data-batch4-paused',document.hidden);html.toggleAttribute('data-batch4-reduced',media.matches);}
 function message(event){
  if(event.source!==parent||parent===window||event.origin!==location.origin||event.data?.type!=='playable-active')return;
  preview=event.data.active!==true;origin=performance.now();
  if(preview){used=false;if(guide)guide.hidden=false;}
  sync();attachNet();
 }
 function mark(element,name){if(element&&!element.classList.contains(name))element.classList.add(name);return element;}
 function geometry(){
  if(!paintApp)return;
  const bowl=paintApp.querySelector('.color-mix-bowl'),tube=paintApp.querySelector('.color-tubes img[alt="red"]');
  if(!bowl||!tube)return;
  const a=paintApp.getBoundingClientRect(),b=bowl.getBoundingClientRect(),t=tube.getBoundingClientRect();
  for(const [key,value]of Object.entries({sx:t.left-a.left+t.width/2,sy:t.top-a.top+t.height/2,ex:b.left-a.left+b.width*.56,ey:b.top-a.top+b.height*.38,tw:t.width,th:t.height}))paintApp.style.setProperty('--paint-'+key,value+'px');
 }
 function attachPaint(){
  if(game!==9)return;
  const app=document.querySelector('#root>div'),round=app?.querySelector('.color-round');if(!app||!round)return;
  paintApp=mark(app,'color-game');
  const panel=mark(round.parentElement?.parentElement?.parentElement,'color-panel');
  if(!panel)return;
  mark(panel.parentElement,'color-header');mark(round.parentElement,'color-round-group');
  const reset=mark(panel.querySelector('button'),'color-reset');
  mark(reset?.previousElementSibling,'color-target-swatch');mark(reset?.parentElement,'color-target-group');
  if(reset)reset.setAttribute('aria-label',"Svuota la ciotola");
  mark(panel.lastElementChild,'color-progress-row');
  const bowl=mark([...app.querySelectorAll('div')].find(e=>e.style.aspectRatio==='1 / 1'||e.style.aspectRatio==='1/1'),'color-mix-bowl');
  if(!bowl)return;
  mark(bowl.parentElement,'color-bowl-wrap');
  const red=app.querySelector('img[alt="red"]');mark(red?.parentElement?.parentElement?.parentElement,'color-tubes');
  if(!guide||!guide.isConnected){guide=document.createElement('p');guide.className='color-guide';guide.textContent="Trascina i colori nella ciotola";app.append(guide);}
  guide.hidden=used;
  if(!bowl.querySelector('.color-preview-paint')){const paint=document.createElement('div');paint.className='color-preview-paint';paint.setAttribute('aria-hidden','true');bowl.append(paint);}
  // A direct tube image would match the legacy div:has(>img[src*=tube_])
  // repair and paint a full-width red pseudo-element on the entire game.
  if(red&&!app.querySelector('.color-preview-tube')){const ghost=document.createElement('div');ghost.className='color-preview-tube';ghost.setAttribute('aria-hidden','true');red.addEventListener('load',geometry,{once:true});app.append(ghost);}
  geometry();
 }
 function input(event){
  if(game!==9||preview||event.isPrimary===false||event.button>0)return;
  if(event.target.closest('.color-tubes img')){used=true;if(guide)guide.hidden=true;}
  if(event.target.closest('.color-reset')){used=false;if(guide)guide.hidden=false;}
 }
 function attachNet(){
  if(game!==33)return;
  const root=document.getElementById('root');if(!root)return;
  let copy=root.querySelector('[data-net-preview-guide]');
  if(!copy){copy=document.createElement('p');copy.className='feed-first-action';copy.dataset.netPreviewGuide='';copy.textContent="Trascina per strappare la rete";root.append(copy);}
  const hidden=!!root.querySelector('p.feed-first-action:not([data-net-preview-guide])');
  if(copy.hidden!==hidden)copy.hidden=hidden;
 }
 const observer=new MutationObserver(()=>{attachPaint();attachNet();});
 if([9,33].includes(game)&&document.getElementById('root'))observer.observe(document.getElementById('root'),{subtree:true,childList:true});
 const resize=new ResizeObserver(geometry);resize.observe(document.documentElement);
 window.PlayableBatch4Preview=Object.freeze({
  get active(){return preview&&!document.hidden;},get reduced(){return media.matches;},
  elapsed(now=performance.now()){return Math.max(0,now-origin);},
  netDrag(width,height,columns,rows,now){return preview&&!document.hidden&&!media.matches?window.PlayablePreviewModels.netPose(Math.max(0,now-origin),width,height,columns,rows):null;}
 });
 addEventListener('message',message);addEventListener('resize',geometry);
 document.addEventListener('pointerdown',input,{capture:true,passive:true});
 document.addEventListener('visibilitychange',sync);media.addEventListener?.('change',sync);
 addEventListener('pagehide',()=>{observer.disconnect();resize.disconnect();removeEventListener('message',message);removeEventListener('resize',geometry);document.removeEventListener('pointerdown',input,true);document.removeEventListener('visibilitychange',sync);media.removeEventListener?.('change',sync);},{once:true});
 sync();attachPaint();attachNet();
})();

;
