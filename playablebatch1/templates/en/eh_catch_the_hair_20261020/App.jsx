/* Consolidated CURRENT browser application. Valid JavaScript/JSX-subset source.
 * Rebuild: node check.js --build. No historical authoring version is substituted.
 * External helpers and inline entry code are preserved in their original execution order.
 */
// TEMPLATE_HTML_BASE64: PCFkb2N0eXBlIGh0bWw+PGh0bWwgbGFuZz0iZW4iIGRhdGEtcGxheWFibGUtbG9hZGluZz0idHJ1ZSI+PGhlYWQ+PG1ldGEgY2hhcnNldD0idXRmLTgiPjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciI+PHRpdGxlPlBsYXlhYmxlPC90aXRsZT48c3R5bGUgPgpAZm9udC1mYWNle2ZvbnQtZmFtaWx5OlBvcHBpbnM7c3JjOnVybCgnLi9hc3NldHMvZm9udHMvUG9wcGlucy1SZWd1bGFyLndvZmYyJykgZm9ybWF0KCd3b2ZmMicpO2ZvbnQtd2VpZ2h0OjQwMDtmb250LWRpc3BsYXk6c3dhcH0KQGZvbnQtZmFjZXtmb250LWZhbWlseTpQb3BwaW5zO3NyYzp1cmwoJy4vYXNzZXRzL2ZvbnRzL1BvcHBpbnMtQm9sZC53b2ZmMicpIGZvcm1hdCgnd29mZjInKTtmb250LXdlaWdodDo3MDA7Zm9udC1kaXNwbGF5OnN3YXB9Cjpyb290e2ZvbnQtZmFtaWx5OlBvcHBpbnMsQXJpYWwsc2Fucy1zZXJpZjtjb2xvcjojZmZmO2JhY2tncm91bmQ6IzIyMjstLWluazojZmZmOy0tdWk6MTstLWFjY2VudDojZmZjZjRjfQoqe2JveC1zaXppbmc6Ym9yZGVyLWJveH1odG1sLGJvZHl7bWFyZ2luOjA7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtvdmVyZmxvdzpoaWRkZW59Ym9keXtvdmVyc2Nyb2xsLWJlaGF2aW9yOm5vbmV9YnV0dG9ue2ZvbnQ6aW5oZXJpdDtjdXJzb3I6cG9pbnRlcjstd2Via2l0LXRhcC1oaWdobGlnaHQtY29sb3I6dHJhbnNwYXJlbnR9YnV0dG9uOmZvY3VzLXZpc2libGV7b3V0bGluZTozcHggc29saWQgI2ZmY2Q0NTtvdXRsaW5lLW9mZnNldDotNXB4fWJ1dHRvbjpkaXNhYmxlZHtjdXJzb3I6ZGVmYXVsdH0KI3N0YWdle3Bvc2l0aW9uOnJlbGF0aXZlO3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7aXNvbGF0aW9uOmlzb2xhdGU7b3ZlcmZsb3c6aGlkZGVuO3RvdWNoLWFjdGlvbjptYW5pcHVsYXRpb247Y29sb3I6dmFyKC0taW5rKX1jYW52YXN7cG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MDt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO2Rpc3BsYXk6YmxvY2t9CiNwbGF5e3Bvc2l0aW9uOmFic29sdXRlO2luc2V0OjA7Ym9yZGVyOjA7YmFja2dyb3VuZDpub25lO3otaW5kZXg6MTtwYWRkaW5nOjA7dG91Y2gtYWN0aW9uOm1hbmlwdWxhdGlvbjtjb2xvcjp0cmFuc3BhcmVudH0KLm1ha2VvdmVyICNwbGF5e3RvdWNoLWFjdGlvbjpub25lfQouaHVke3Bvc2l0aW9uOmFic29sdXRlO3RvcDptYXgoY2FsYygzMHB4ICogdmFyKC0tdWkpKSxlbnYoc2FmZS1hcmVhLWluc2V0LXRvcCkpO2xlZnQ6Y2FsYygzMHB4ICogdmFyKC0tdWkpKTtyaWdodDpjYWxjKDMwcHggKiB2YXIoLS11aSkpO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpmbGV4LXN0YXJ0O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO3BvaW50ZXItZXZlbnRzOm5vbmU7ei1pbmRleDoyO3RleHQtc2hhZG93OjAgMXB4IDRweCAjMDAwOTtmb250LXNpemU6Y2FsYygyOHB4ICogdmFyKC0tdWkpKTtmb250LXdlaWdodDo3MDA7bGluZS1oZWlnaHQ6MS4yNTtsZXR0ZXItc3BhY2luZzotLjZweDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXN9Ci5odWQuY2VudGVye2p1c3RpZnktY29udGVudDpjZW50ZXJ9Lmh1ZCBzbWFsbHtmb250LXNpemU6Y2FsYygxNHB4ICogdmFyKC0tdWkpKTtkaXNwbGF5OmJsb2NrO2xpbmUtaGVpZ2h0OjEuNDtsZXR0ZXItc3BhY2luZzowO2ZvbnQtd2VpZ2h0OjQwMDttYXJnaW4tdG9wOjNweH0uaHVkIHNwYW46ZW1wdHl7ZGlzcGxheTpub25lfQojZ3VpZGV7cG9zaXRpb246YWJzb2x1dGU7ei1pbmRleDoyO2xlZnQ6Y2FsYygzMHB4ICogdmFyKC0tdWkpKTtyaWdodDpjYWxjKDMwcHggKiB2YXIoLS11aSkpO2JvdHRvbTptYXgoY2FsYyg2MnB4ICogdmFyKC0tdWkpKSxlbnYoc2FmZS1hcmVhLWluc2V0LWJvdHRvbSkpO2ZvbnQtc2l6ZTpjYWxjKDE4cHggKiB2YXIoLS11aSkpO2ZvbnQtd2VpZ2h0OjcwMDtsaW5lLWhlaWdodDoxLjQ7dGV4dC1hbGlnbjpjZW50ZXI7cG9pbnRlci1ldmVudHM6bm9uZTt0ZXh0LXNoYWRvdzowIDFweCA0cHggIzAwMGE7YW5pbWF0aW9uOmZsb2F0IDJzIGVhc2UtaW4tb3V0IGluZmluaXRlO21hcmdpbjowfQojZ3VpZGVbaGlkZGVuXSwgW2hpZGRlbl17ZGlzcGxheTpub25lIWltcG9ydGFudH1odG1sW2RhdGEtZmVlZC1wcmV2aWV3PSJ0cnVlIl0gI2d1aWRlLGh0bWxbZGF0YS1mZWVkLXByZXZpZXc9InRydWUiXSAuY29udHJvbHN7dmlzaWJpbGl0eTpoaWRkZW59LmNvbnRyb2xze3Bvc2l0aW9uOmFic29sdXRlO3otaW5kZXg6MztsZWZ0OmNhbGMoMzBweCAqIHZhcigtLXVpKSk7cmlnaHQ6Y2FsYygzMHB4ICogdmFyKC0tdWkpKTtib3R0b206bWF4KGNhbGMoNTBweCAqIHZhcigtLXVpKSksZW52KHNhZmUtYXJlYS1pbnNldC1ib3R0b20pKTtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Z2FwOjEycHg7cG9pbnRlci1ldmVudHM6bm9uZX0KLmNvbnRyb2x7bWluLWhlaWdodDo0OHB4O21pbi13aWR0aDo0OHB4O3BhZGRpbmc6MTBweCAyMnB4O2JvcmRlcjowO2JvcmRlci1yYWRpdXM6MzBweDtiYWNrZ3JvdW5kOiNmZmY7Y29sb3I6IzIwMjUyYjtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjE2cHg7Ym94LXNoYWRvdzowIDJweCAxMHB4ICMwMDAyO3BvaW50ZXItZXZlbnRzOmF1dG99LmNvbnRyb2w6YWN0aXZle3RyYW5zZm9ybTpzY2FsZSguOTcpfSNkaXJlY3Rpb257bWFyZ2luLWxlZnQ6YXV0bztib3JkZXI6MXB4IHNvbGlkICNmZmZmZmY4MDtiYWNrZ3JvdW5kOiMyMjI4O2NvbG9yOiNmZmY7YmFja2Ryb3AtZmlsdGVyOmJsdXIoOHB4KTtwYWRkaW5nOjEwcHggMTNweDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo4cHh9I2RpcmVjdGlvbiBzdmd7d2lkdGg6MjJweDtoZWlnaHQ6MjJweDt0cmFuc2l0aW9uOnRyYW5zZm9ybSAuMnN9CiNyZXN1bHR7cG9zaXRpb246YWJzb2x1dGU7ei1pbmRleDoyO2xlZnQ6MjRweDtyaWdodDoyNHB4O2JvdHRvbTpjYWxjKDEyMnB4ICogdmFyKC0tdWkpKTt0ZXh0LWFsaWduOmNlbnRlcjtwb2ludGVyLWV2ZW50czpub25lO2ZvbnQtc2l6ZTpjYWxjKDI4cHggKiB2YXIoLS11aSkpO2ZvbnQtd2VpZ2h0OjcwMDtsaW5lLWhlaWdodDoxLjI7dGV4dC1zaGFkb3c6MCAycHggOHB4ICMwMDA5fSNyZXN1bHQgc21hbGx7Zm9udC1zaXplOmNhbGMoMThweCAqIHZhcigtLXVpKSk7Zm9udC13ZWlnaHQ6NDAwO2Rpc3BsYXk6YmxvY2s7bWFyZ2luLXRvcDo4cHh9CiNsb2FkaW5ne3Bvc2l0aW9uOmFic29sdXRlO2luc2V0OjA7ei1pbmRleDo2O2JhY2tncm91bmQ6IzI1MjcyYTtkaXNwbGF5OmdyaWQ7cGxhY2UtY29udGVudDpjZW50ZXI7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzozMHB4O2ZvbnQtc2l6ZToxOHB4O2xpbmUtaGVpZ2h0OjEuNX0jbG9hZGluZzpiZWZvcmV7Y29udGVudDonJzt3aWR0aDoyOHB4O2hlaWdodDoyOHB4O2JvcmRlcjozcHggc29saWQgI2ZmZmZmZjM1O2JvcmRlci10b3AtY29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjUwJTttYXJnaW46MCBhdXRvIDE4cHg7YW5pbWF0aW9uOnR1cm4gLjhzIGxpbmVhciBpbmZpbml0ZX0jbG9hZGluZy5lcnJvcjpiZWZvcmV7ZGlzcGxheTpub25lfS5oYWlyLWNhdGNoey0taW5rOiMzMDI1MWV9LmhhaXItY2F0Y2ggLmh1ZCwuaGFpci1jYXRjaCAjZ3VpZGUsLmhhaXItY2F0Y2ggI3Jlc3VsdHt0ZXh0LXNoYWRvdzpub25lfS5oYWlyLWNhdGNoICNndWlkZXtib3R0b206Y2FsYyg3MHB4ICogdmFyKC0tdWkpKX0uaGFpci1jYXRjaCAuaHVke3RvcDpjYWxjKDUwcHggKiB2YXIoLS11aSkpfS5oYWlyLWNhdGNoICNyZXN1bHR7Ym90dG9tOmNhbGMoMTcwcHggKiB2YXIoLS11aSkpfQouaGFpci1jYXRjaCAjZ3VpZGV7Y29sb3I6I2ZmZjt0ZXh0LXNoYWRvdzowIDFweCA0cHggIzAwMGJ9LmhhaXItY2F0Y2ggLmh1ZCBzcGFuOm5vdCg6ZW1wdHkpe2JhY2tncm91bmQ6I2ZmZmVmN2VkO2JvcmRlci1yYWRpdXM6MjRweDtwYWRkaW5nOjZweCAxOHB4fS5oYWlyLXNoYXZlICNndWlkZXtib3R0b206Y2FsYygxMjBweCAqIHZhcigtLXVpKSl9Lm1ha2VvdmVyIC5odWR7Zm9udC1zaXplOmNhbGMoMjRweCAqIHZhcigtLXVpKSl9Lm1ha2VvdmVyIC5odWQgI2xlZnR7bWF4LXdpZHRoOjc1JX0jcGF1c2V7cG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MDt6LWluZGV4Ojc7YmFja2dyb3VuZDojMTUxOTFjOTA7ZGlzcGxheTpncmlkO3BsYWNlLWNvbnRlbnQ6Y2VudGVyO2JhY2tkcm9wLWZpbHRlcjpibHVyKDRweCl9I3Jlc3VtZXtib3JkZXI6MXB4IHNvbGlkICNmZmZmZmY4MDtiYWNrZ3JvdW5kOiNmZmY7Y29sb3I6IzIyMjtmb250LXNpemU6MThweDtwYWRkaW5nOjE1cHggMjVweDtib3JkZXItcmFkaXVzOjMwcHg7bWluLWhlaWdodDo1MHB4fQouc3J7cG9zaXRpb246YWJzb2x1dGU7d2lkdGg6MXB4O2hlaWdodDoxcHg7b3ZlcmZsb3c6aGlkZGVuO2NsaXA6cmVjdCgwLDAsMCwwKX1Aa2V5ZnJhbWVzIGZsb2F0ezUwJXt0cmFuc2Zvcm06dHJhbnNsYXRlWSgtNXB4KX19QGtleWZyYW1lcyB0dXJue3Rve3RyYW5zZm9ybTpyb3RhdGUoMzYwZGVnKX19QG1lZGlhKHByZWZlcnMtcmVkdWNlZC1tb3Rpb246cmVkdWNlKXsqLCo6YmVmb3Jle2FuaW1hdGlvbjpub25lIWltcG9ydGFudDt0cmFuc2l0aW9uOm5vbmUhaW1wb3J0YW50fX0KCjwvc3R5bGU+PHN0eWxlIGRhdGEtZ3VpZGUtY2VudGVyaW5nPSIyMDI2MTAyMSI+Ci8qIFVzZXIgb3ZlcnJpZGUgMjAyNi0xMC0yMTogZmF2b3IgdmlzdWFsIGNlbnRlciwgbm90IGEgZml4ZWQgdXBwZXIgYmFuZC4gKi8KaHRtbDpyb290OnJvb3Q6cm9vdCA6aXMoI3Jvb3QsI2dhbWUsI3N0YWdlKTppcygjcm9vdCwjZ2FtZSwjc3RhZ2UpIHAjZ3VpZGV7cG9zaXRpb246Zml4ZWQhaW1wb3J0YW50O3RvcDoxNCUhaW1wb3J0YW50O2JvdHRvbTphdXRvIWltcG9ydGFudDtsZWZ0OjUwJSFpbXBvcnRhbnQ7cmlnaHQ6YXV0byFpbXBvcnRhbnQ7d2lkdGg6bWF4LWNvbnRlbnQhaW1wb3J0YW50O21heC13aWR0aDpjYWxjKDEwMHZ3IC0gNjBweCkhaW1wb3J0YW50O21pbi1oZWlnaHQ6MCFpbXBvcnRhbnQ7bWFyZ2luOjAhaW1wb3J0YW50O3RleHQtYWxpZ246Y2VudGVyIWltcG9ydGFudDt0cmFuc2xhdGU6LTUwJSAtNTAlIWltcG9ydGFudDt0cmFuc2Zvcm06bm9uZSFpbXBvcnRhbnQ7cG9pbnRlci1ldmVudHM6bm9uZSFpbXBvcnRhbnQ7ei1pbmRleDoyNSFpbXBvcnRhbnQ7b3ZlcmZsb3ctd3JhcDphbnl3aGVyZX0KCjwvc3R5bGU+CjxzdHlsZSBkYXRhLWJhdGNoNC1wcmV2aWV3PSIiPgovKiBPbmx5IHRoZSBmb3VyIG5ld2x5IHNlbGVjdGVkIGdhbWVzLiBIb3N0IGZyYW1lLCBncmFkaWVudHMgYW5kIGxhdW5jaCBwaWxsIHN0YXkgaG9zdC1vd25lZC4gKi8KQGtleWZyYW1lcyBiYXRjaDQtZ3VpZGUtYnJlYXRoZXswJSwxMDAle2ZpbHRlcjpvcGFjaXR5KDEpfTUwJXtmaWx0ZXI6b3BhY2l0eSguNjgpfX0KaHRtbDpyb290OnJvb3QgOmlzKC5jb2xvci1ndWlkZSxwLmZlZWQtZmlyc3QtYWN0aW9uLC5oaW50LCNndWlkZSl7YW5pbWF0aW9uOmJhdGNoNC1ndWlkZS1icmVhdGhlIDIuNHMgZWFzZS1pbi1vdXQgaW5maW5pdGUhaW1wb3J0YW50fQpodG1sW2RhdGEtYmF0Y2g0LXBhdXNlZF06cm9vdDpyb290IDppcyguY29sb3ItZ3VpZGUscC5mZWVkLWZpcnN0LWFjdGlvbiwuaGludCwjZ3VpZGUpe2FuaW1hdGlvbi1wbGF5LXN0YXRlOnBhdXNlZCFpbXBvcnRhbnR9Cmh0bWxbZGF0YS1iYXRjaDQtZ2FtZT0iMzMiXTpyb290OnJvb3QgcC5mZWVkLWZpcnN0LWFjdGlvbntmb250LWZhbWlseTp2YXIoLS1mb250LWJvZHksc3lzdGVtLXVpLHNhbnMtc2VyaWYpIWltcG9ydGFudDtmb250LXdlaWdodDo3MDAhaW1wb3J0YW50O2NvbG9yOiMxNzM4NGEhaW1wb3J0YW50O2JhY2tncm91bmQ6I2ZmZiFpbXBvcnRhbnQ7Ym9yZGVyLXJhZGl1czo5OTlweCFpbXBvcnRhbnQ7cGFkZGluZzoxMHB4IDE4cHghaW1wb3J0YW50O2JveC1zaXppbmc6Ym9yZGVyLWJveDt0ZXh0LXNoYWRvdzpub25lIWltcG9ydGFudDtib3gtc2hhZG93OjAgM3B4IDEycHggIzAwMWIzODMzfQpodG1sW2RhdGEtYmF0Y2g0LWdhbWU9IjMzIl0gLmh1ZHtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyfQovKiBLZWVwIHRoZSBDVEEgcHJldmlldyBmb2N1c2VkIG9uIHRoZSBkZW1vbnN0cmF0aW9uLiBSZXN0b3JlIHRoZSBIVUQgb24gZW50cnkuICovCmh0bWxbZGF0YS1iYXRjaDQtZ2FtZT0iMzMiXVtkYXRhLWJhdGNoNC1wcmV2aWV3PSJ0cnVlIl0gLmh1ZCwKaHRtbFtkYXRhLWJhdGNoNC1nYW1lPSI5Il1bZGF0YS1iYXRjaDQtcHJldmlldz0idHJ1ZSJdIC5jb2xvci1oZWFkZXJ7dmlzaWJpbGl0eTpoaWRkZW4haW1wb3J0YW50fQpbZGF0YS1uZXQtcHJldmlldy1ndWlkZV17ZGlzcGxheTpub25lfQpodG1sW2RhdGEtYmF0Y2g0LXByZXZpZXc9InRydWUiXSBbZGF0YS1uZXQtcHJldmlldy1ndWlkZV06bm90KFtoaWRkZW5dKXtkaXNwbGF5OmJsb2NrO2NvbG9yOiNlNGZhZmY7Zm9udC1zaXplOjE4cHg7bGluZS1oZWlnaHQ6MS4zNX0KaHRtbFtkYXRhLWJhdGNoNC1nYW1lPSI0NyJdW2RhdGEtYmF0Y2g0LXByZXZpZXc9InRydWUiXTpyb290OnJvb3QgLmhpbnR7dmlzaWJpbGl0eTp2aXNpYmxlIWltcG9ydGFudH0KaHRtbFtkYXRhLWJhdGNoNC1wcmV2aWV3PSJmYWxzZSJdOnJvb3Q6cm9vdCAuaGludFtzdHlsZSo9InZpc2liaWxpdHk6IGhpZGRlbiJde2FuaW1hdGlvbjpub25lIWltcG9ydGFudH0KaHRtbDpyb290OnJvb3QgLmNvbG9yLWd1aWRle3Bvc2l0aW9uOmZpeGVkO3otaW5kZXg6MjU7dG9wOjI0JTtsZWZ0OjUwJTt0cmFuc2xhdGU6LTUwJSAtNTAlO3dpZHRoOm1heC1jb250ZW50O21heC13aWR0aDpjYWxjKDEwMCUgLSA2MHB4KTttYXJnaW46MDt0ZXh0LWFsaWduOmNlbnRlcjtwb2ludGVyLWV2ZW50czpub25lO2NvbG9yOiMzMzQxNTU7Zm9udDo3MDAgMThweC8xLjQgdmFyKC0tZm9udC1kaXNwbGF5LHN5c3RlbS11aSxzYW5zLXNlcmlmKX0KLmNvbG9yLWd1aWRlW2hpZGRlbl17ZGlzcGxheTpub25lIWltcG9ydGFudH0KaHRtbDpyb290OnJvb3QgLmNvbG9yLWhlYWRlcntwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDowO3BvaW50ZXItZXZlbnRzOm5vbmU7cGFkZGluZzowIWltcG9ydGFudDt6LWluZGV4OjEwIWltcG9ydGFudH0KaHRtbDpyb290OnJvb3QgLmNvbG9yLXBhbmVse3Bvc2l0aW9uOnN0YXRpYyFpbXBvcnRhbnQ7cGFkZGluZzowIWltcG9ydGFudDtib3gtc2hhZG93Om5vbmUhaW1wb3J0YW50O2JhY2tncm91bmQ6dHJhbnNwYXJlbnQhaW1wb3J0YW50O3BvaW50ZXItZXZlbnRzOm5vbmV9Cmh0bWw6cm9vdDpyb290IC5jb2xvci1yb3VuZHtwb3NpdGlvbjphYnNvbHV0ZTt0b3A6MzBweDtsZWZ0OjMwcHh9Cmh0bWw6cm9vdDpyb290IC5jb2xvci1yb3VuZC1ncm91cD5kaXY6bm90KC5jb2xvci1yb3VuZCl7ZGlzcGxheTpub25lfQpodG1sOnJvb3Q6cm9vdCAuY29sb3ItdGFyZ2V0LWdyb3Vwe3Bvc2l0aW9uOmFic29sdXRlO3RvcDozMHB4O2xlZnQ6Y2FsYyg1MCUgLSAxOHB4KTt0cmFuc2Zvcm06bm9uZTtwb2ludGVyLWV2ZW50czphdXRvfQpodG1sOnJvb3Q6cm9vdCAuY29sb3ItdGFyZ2V0LXN3YXRjaHt3aWR0aDozNnB4IWltcG9ydGFudDtoZWlnaHQ6MzZweCFpbXBvcnRhbnR9Cmh0bWw6cm9vdDpyb290IC5jb2xvci1yZXNldHtwb3NpdGlvbjpmaXhlZDtib3R0b206NTBweDtyaWdodDozMHB4fQpodG1sOnJvb3Q6cm9vdCAuY29sb3ItbWF0Y2gtaHVke3Bvc2l0aW9uOmZpeGVkO3RvcDozMHB4O3JpZ2h0OjMwcHh9Cmh0bWw6cm9vdDpyb290IC5jb2xvci1wcm9ncmVzcy1yb3d7cG9zaXRpb246YWJzb2x1dGU7dG9wOjgycHg7bGVmdDozMHB4O3JpZ2h0OjMwcHg7cG9pbnRlci1ldmVudHM6bm9uZX0KaHRtbDpyb290OnJvb3QgLmNvbG9yLWJvd2wtd3JhcHtwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDowO3BhZGRpbmc6MCFpbXBvcnRhbnQ7cG9pbnRlci1ldmVudHM6bm9uZX0KaHRtbDpyb290OnJvb3QgLmNvbG9yLW1peC1ib3dse3Bvc2l0aW9uOmFic29sdXRlIWltcG9ydGFudDtsZWZ0OjUwJSFpbXBvcnRhbnQ7dG9wOjQ3JSFpbXBvcnRhbnQ7dHJhbnNsYXRlOi01MCUgLTUwJTt0cmFuc2Zvcm06bm9uZSFpbXBvcnRhbnQ7bWluLXdpZHRoOjAhaW1wb3J0YW50O2JveC1zaXppbmc6Ym9yZGVyLWJveCFpbXBvcnRhbnQ7d2lkdGg6bWluKDYydncsMzV2aCkhaW1wb3J0YW50O2hlaWdodDphdXRvO3BvaW50ZXItZXZlbnRzOmF1dG99Cmh0bWw6cm9vdDpyb290IC5jb2xvci1taXgtYm93bD5kaXY6bm90KC5jb2xvci1wcmV2aWV3LXBhaW50KXtkaXNwbGF5Om5vbmV9Cmh0bWw6cm9vdDpyb290IC5jb2xvci10dWJlc3twb3NpdGlvbjphYnNvbHV0ZTtsZWZ0OjMwcHg7cmlnaHQ6MzBweDt0b3A6NjYlO2hlaWdodDoxMyU7cGFkZGluZzowIWltcG9ydGFudDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50IWltcG9ydGFudDtib3gtc2hhZG93Om5vbmUhaW1wb3J0YW50O3BvaW50ZXItZXZlbnRzOmF1dG99Cmh0bWw6cm9vdDpyb290IC5jb2xvci10dWJlcz5kaXZ7aGVpZ2h0OjEwMCUhaW1wb3J0YW50fQpodG1sW2RhdGEtYmF0Y2g0LXByZXZpZXc9InRydWUiXSAuY29sb3ItcmVzZXR7dmlzaWJpbGl0eTpoaWRkZW47cG9pbnRlci1ldmVudHM6bm9uZX0KLmNvbG9yLXByZXZpZXctcGFpbnR7cG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6OCU7Ym9yZGVyLXJhZGl1czo1MCU7cG9pbnRlci1ldmVudHM6bm9uZTtkaXNwbGF5Om5vbmU7YmFja2dyb3VuZDpyYWRpYWwtZ3JhZGllbnQoZWxsaXBzZSBhdCAzNSUgMzUlLCNmYmE2YjAgMCUsI2NmNjM3YiAyNiUsIzZiNWRjYyA2NCUsIzNiNGE5ZiAxMDAlKTtib3gtc2hhZG93Omluc2V0IDAgOHB4IDE4cHggI2ZmZmZmZjQ1fQouY29sb3ItcHJldmlldy10dWJle3Bvc2l0aW9uOmFic29sdXRlIWltcG9ydGFudDt0b3A6MDtsZWZ0OjA7d2lkdGg6dmFyKC0tcGFpbnQtdHcpIWltcG9ydGFudDtoZWlnaHQ6dmFyKC0tcGFpbnQtdGgpIWltcG9ydGFudDtib3gtc2l6aW5nOmJvcmRlci1ib3g7cG9pbnRlci1ldmVudHM6bm9uZTt6LWluZGV4OjE1O2Rpc3BsYXk6bm9uZTtib3JkZXI6M3B4IHNvbGlkICMwZjE3MmFiODtib3JkZXItcmFkaXVzOjE0cHggMTRweCA5cHggOXB4O2JhY2tncm91bmQ6bGluZWFyLWdyYWRpZW50KCNmZjg3OTQsI2Q2MjgzOSk7ZmlsdGVyOmRyb3Atc2hhZG93KDAgNHB4IDZweCAjMDAwMyl9Cmh0bWxbZGF0YS1iYXRjaDQtcHJldmlldz0idHJ1ZSJdIC5jb2xvci1wcmV2aWV3LXBhaW50e2Rpc3BsYXk6YmxvY2s7YW5pbWF0aW9uOnBhaW50LW1peC1wcmV2aWV3IDMuNnMgZWFzZS1pbi1vdXQgaW5maW5pdGV9Cmh0bWxbZGF0YS1iYXRjaDQtcHJldmlldz0idHJ1ZSJdIC5jb2xvci1wcmV2aWV3LXR1YmV7ZGlzcGxheTpibG9jazthbmltYXRpb246cGFpbnQtdHViZS1wcmV2aWV3IDMuNnMgZWFzZS1pbi1vdXQgaW5maW5pdGV9CkBrZXlmcmFtZXMgcGFpbnQtbWl4LXByZXZpZXd7MCUsMTglLDEwMCV7b3BhY2l0eTowO3NjYWxlOi4zNX00NiUsNzIle29wYWNpdHk6MTtzY2FsZToxfTg2JXtvcGFjaXR5Oi4yO3NjYWxlOjF9fQpAa2V5ZnJhbWVzIHBhaW50LXR1YmUtcHJldmlld3swJSw3JXtvcGFjaXR5OjA7dHJhbnNmb3JtOnRyYW5zbGF0ZShjYWxjKHZhcigtLXBhaW50LXN4KSAtIDUwJSksY2FsYyh2YXIoLS1wYWludC1zeSkgLSA1MCUpKSByb3RhdGUoMCl9MTQle29wYWNpdHk6MX00MCUsNjIle29wYWNpdHk6MTt0cmFuc2Zvcm06dHJhbnNsYXRlKGNhbGModmFyKC0tcGFpbnQtZXgpIC0gNTAlKSxjYWxjKHZhcigtLXBhaW50LWV5KSAtIDUwJSkpIHJvdGF0ZSgtMjJkZWcpfTc4JSwxMDAle29wYWNpdHk6MDt0cmFuc2Zvcm06dHJhbnNsYXRlKGNhbGModmFyKC0tcGFpbnQtZXgpIC0gNTAlKSxjYWxjKHZhcigtLXBhaW50LWV5KSAtIDUwJSkpIHJvdGF0ZSgtMjJkZWcpfX0KaHRtbFtkYXRhLWJhdGNoNC1wYXVzZWRdIDppcyguY29sb3ItcHJldmlldy1wYWludCwuY29sb3ItcHJldmlldy10dWJlKXthbmltYXRpb24tcGxheS1zdGF0ZTpwYXVzZWQhaW1wb3J0YW50fQpodG1sOnJvb3Q6cm9vdCAjc3RhZ2UgI2d1aWRle3Zpc2liaWxpdHk6dmlzaWJsZSFpbXBvcnRhbnQ7Y29sb3I6IzMwMjUxZSFpbXBvcnRhbnQ7dGV4dC1zaGFkb3c6bm9uZSFpbXBvcnRhbnR9CkBtZWRpYShwcmVmZXJzLXJlZHVjZWQtbW90aW9uOnJlZHVjZSl7aHRtbDpyb290OnJvb3QgOmlzKC5jb2xvci1ndWlkZSxwLmZlZWQtZmlyc3QtYWN0aW9uLC5oaW50LCNndWlkZSl7YW5pbWF0aW9uOm5vbmUhaW1wb3J0YW50fS5jb2xvci1wcmV2aWV3LXR1YmV7ZGlzcGxheTpub25lIWltcG9ydGFudH0uY29sb3ItcHJldmlldy1wYWludHthbmltYXRpb246bm9uZSFpbXBvcnRhbnQ7b3BhY2l0eTouNyFpbXBvcnRhbnQ7c2NhbGU6MSFpbXBvcnRhbnR9fQoKPC9zdHlsZT4KCgo8L2hlYWQ+PGJvZHk+PG1haW4gaWQ9InN0YWdlIj48Y2FudmFzIGlkPSJjYW52YXMiIGFyaWEtaGlkZGVuPSJ0cnVlIj48L2NhbnZhcz48YnV0dG9uIGlkPSJwbGF5IiBhcmlhLWxhYmVsPSJQbGF5Ij48L2J1dHRvbj48ZGl2IGlkPSJodWQiIGNsYXNzPSJodWQiIGFyaWEtaGlkZGVuPSJ0cnVlIj48c3BhbiBpZD0ibGVmdCI+PC9zcGFuPjxzcGFuIGlkPSJyaWdodCI+PC9zcGFuPjwvZGl2PjxwIGlkPSJndWlkZSI+PC9wPjxkaXYgaWQ9InJlc3VsdCIgaGlkZGVuPjxzcGFuIGlkPSJyZXN1bHRUaXRsZSI+PC9zcGFuPjxzbWFsbCBpZD0icmVzdWx0U3ViIj48L3NtYWxsPjwvZGl2PjxkaXYgY2xhc3M9ImNvbnRyb2xzIj48YnV0dG9uIGlkPSJyZXRyeSIgY2xhc3M9ImNvbnRyb2wiIGhpZGRlbj5BZ2FpbjwvYnV0dG9uPjxidXR0b24gaWQ9ImRpcmVjdGlvbiIgY2xhc3M9ImNvbnRyb2wiIGhpZGRlbiBhcmlhLWxhYmVsPSJDaGFuZ2Ugc2hhdmluZyBkaXJlY3Rpb24iPjxzdmcgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBhcmlhLWhpZGRlbj0idHJ1ZSI+PHBhdGggZD0iTTYgMTdWNG0tMyAzIDMtMyAzIDNtOSAwdjEzbS0zLTMgMyAzIDMtMyIvPjwvc3ZnPjxzcGFuPkRpcmVjdGlvbjwvc3Bhbj48L2J1dHRvbj48L2Rpdj48ZGl2IGlkPSJwYXVzZSIgaGlkZGVuPjxidXR0b24gaWQ9InJlc3VtZSI+VGFwIHRvIHJlc3VtZTwvYnV0dG9uPjwvZGl2PjxkaXYgaWQ9ImxvYWRpbmciIHJvbGU9InN0YXR1cyI+TG9hZGluZ+KApjwvZGl2PjxkaXYgaWQ9InN0YXR1cyIgcm9sZT0ic3RhdHVzIiBhcmlhLWxpdmU9InBvbGl0ZSIgY2xhc3M9InNyIj48L2Rpdj48L21haW4+PHNjcmlwdCBzcmM9Ii4vYnVuZGxlLmpzIj48L3NjcmlwdD4KPC9ib2R5PjwvaHRtbD4K

;/* Current runtime segment: game-data.js */
window.GAME_SPEC={
  "id": "hair-catch",
  "title": "Catch the Hair",
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

;/* Current runtime segment: engine.js */
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

;/* Current runtime segment: game.js */
window.createGame=function(R){
 const {ctx:c,spec:s}=R,a=s.assets,m=new HairCatch(s.settings);let feedback='',previewAge=0;
 function reset(){m.reset();feedback='';previewAge=0;R.guide(R.config.texts.find(t=>t.id==='GUIDE')?.value||'Tap to catch the hair');R.hud('','',true);R.setAction('Catch the falling hair');R.result('');}
 return{reset,previewUpdate(dt){previewAge+=dt;},state:()=>({state:m.state,selected:m.selected,y:m.y,score:m.score,started:m.started}),isPlaying:()=>m.started,
 action(){const hit=m.tap();if(hit.score!==undefined){feedback=hit.score>=98?'Perfect fit!':hit.score>=70?'Almost!':'Try the next look';R.tone(hit.score>70?'good':'bad');R.announce(hit.score.toFixed(2)+' percent. '+feedback);}R.guide('',false);},
 update(dt){m.tick(dt);if(m.state==='stopped'){const p=R.reduced?1:R.ease(Math.min(1,m.scoreAge));R.hud((m.score*p).toFixed(2)+'%','',true);}else R.hud('','',true);},
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

;/* Current runtime segment: runtime.js */
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
function reset(){endPointer();R.silence();paused=false;el('pause').hidden=true;R.result('');el('direction').hidden=true;app.reset();R.announce('Ready');if(running)app.draw(0);last=0;}
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
async function boot(){try{const c=await fetch('./game.config.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Configuration failed to load');return r.json();});Object.assign(config,c);for(const t of c.tweaks||[]){if(typeof t.value==='number'&&Number.isFinite(t.value))spec.settings[t.id]=R.clamp(t.value,t.min??-Infinity,t.max??Infinity);}await Promise.all(c.images.map(async slot=>{if(!slot.path||/^(https?:|data:)/.test(slot.path))throw Error('Image slot must use a local relative path: '+slot.id);const im=new Image();im.src=slot.path;await im.decode();images[slot.id]=im;}));await document.fonts.ready;document.title=spec.title;el('stage').className=spec.id;app=window.createGame(R);size();reset();running=true;el('loading').hidden=true;app.draw(0);document.documentElement.dataset.playableLoading='false';palette();requestAnimationFrame(loop);}catch(e){el('loading').classList.add('error');el('loading').textContent='Could not load this game. '+e.message;console.error(e);}}
boot();
})();

;

;/* Current runtime segment: preview-models.js */
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

;/* Current runtime segment: preview-controller.js */
var __PLAYABLE_TEMPLATE_SCRIPT_5=(()=>{var node=document.createElement("script");for(var entry of Object.entries({"data-batch4-preview":"","defer":"","data-game":"77","src":"./preview-controller.js?v=b487e18c9adf"}))node.setAttribute(entry[0],entry[1]);return node;})();
/* Game-specific FYP presentation. Never sends or simulates gameplay input. */
(()=>{
 'use strict';
 const game=Number(__PLAYABLE_TEMPLATE_SCRIPT_5?.dataset.game),html=document.documentElement;
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
  if(reset)reset.setAttribute('aria-label','Clear mixed paint');
  mark(panel.lastElementChild,'color-progress-row');
  const bowl=mark([...app.querySelectorAll('div')].find(e=>e.style.aspectRatio==='1 / 1'||e.style.aspectRatio==='1/1'),'color-mix-bowl');
  if(!bowl)return;
  mark(bowl.parentElement,'color-bowl-wrap');
  const red=app.querySelector('img[alt="red"]');mark(red?.parentElement?.parentElement?.parentElement,'color-tubes');
  if(!guide||!guide.isConnected){guide=document.createElement('p');guide.className='color-guide';guide.textContent='Drag paint into the bowl';app.append(guide);}
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
  if(!copy){copy=document.createElement('p');copy.className='feed-first-action';copy.dataset.netPreviewGuide='';copy.textContent='Drag the net to tear it';root.append(copy);}
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
