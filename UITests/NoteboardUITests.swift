import XCTest

final class NoteboardUITests: XCTestCase {
    @MainActor
    func testLaunchShowsSidebar() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Library"].waitForExistence(timeout: 5))
    }
}
