"""내부 시험용: v3 현장 엔진을 과거 스페인 여행 시각으로 구동.
실제 시간/시스템 날짜/사용자 localStorage는 변경하지 않습니다.
"""
import asyncio
from playwright.async_api import async_playwright

FIXED_UTC = 1792828800000  # 2026-10-24 08:00 UTC: Philadelphia 04:00, Barcelona 10:00

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(timezone_id='America/New_York', viewport={'width':390,'height':844})
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.add_init_script(f"""(()=>{{const NativeDate=Date,fixed={FIXED_UTC};class TestDate extends NativeDate{{constructor(...a){{if(!a.length)super(fixed);else super(...a)}}static now(){{return fixed}}}}Object.setPrototypeOf(TestDate,NativeDate);window.Date=TestDate}})();""")
        async def route(r):
            url = r.request.url
            if 'open-meteo.com' in url:
                await r.fulfill(status=200, content_type='application/json', body='''{"daily":{"time":["2026-10-24","2026-10-25","2026-10-26","2026-10-27","2026-10-28","2026-10-29","2026-10-30","2026-10-31"],"weather_code":[3,61,1,2,0,3,61,2],"temperature_2m_max":[20,17,22,21,23,19,18,20],"temperature_2m_min":[12,10,14,13,14,11,10,12],"precipitation_probability_max":[10,75,5,20,0,10,60,20],"precipitation_sum":[0,4,0,0,0,0,2,0]},"hourly":{"time":[],"weather_code":[]}}''')
            elif 'frankfurter.dev' in url:
                await r.fulfill(status=200, content_type='application/json', body='[{"date":"2026-10-23","base":"USD","quote":"EUR","rate":0.86}]')
            else:
                await r.continue_()
        await page.route('**/*', route)
        await page.goto('http://127.0.0.1:8111/index.html', wait_until='domcontentloaded')
        await page.wait_for_timeout(1800)
        home = await page.locator('#main').inner_text()
        assert '필라델피아' in home and '오전 4:00' in home, 'Philadelphia virtual time missing'
        assert '바르셀로나' in home and '오전 10:00' in home, 'Barcelona virtual time missing'
        assert '€0.86 EUR' in home, 'EUR fixture rate missing'
        assert '현재 구간 실행 안내' in home or '오늘 일정' in home, 'Spain live-day card missing'
        await page.locator('[data-action="weekly-weather"]').first.click()
        weather = await page.locator('#sheetWrap').inner_text()
        assert '2주 날씨' in weather and '10/24' in weather and '💧75%' in weather, 'Weather view fixture missing'
        await page.get_by_role('button', name='닫기').click()
        await page.locator('#tabbar [data-id="airport"]').click()
        assert 'AA742' in await page.locator('#main').inner_text(), 'Flights-only Air tab did not show Spain flight details'
        await page.locator('#tabbar [data-id="packing"]').click()
        assert await page.locator('.packing-frame').count() == 1, 'Packing frame missing'
        await page.locator('#tabbar [data-id="manage"]').click()
        await page.locator('#main [data-id="important"]').click()
        assert 'Info' in await page.locator('#main').inner_text(), 'Migrated Info screen did not open from Manage'
        assert not errors, f'JS errors: {errors}'
        print('PASS: past Spain virtual date; Philadelphia and destination clock; home live itinerary; EUR display; weather sheet; air, packing and Info tabs; zero JS errors.')
        print('Reminder: weather was a deterministic test fixture, not a historical observation or a real forecast.')
        await browser.close()

asyncio.run(main())
