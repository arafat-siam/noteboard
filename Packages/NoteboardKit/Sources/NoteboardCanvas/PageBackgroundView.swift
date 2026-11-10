#if canImport(SwiftUI)
import SwiftUI
import NoteboardCore

/// Draws a page's paper (colour + template lines) at any size. Template measurements are
/// in page points, so lines stay aligned with ink stored in page coordinates.
public struct PageBackgroundView: View {
    let background: PageBackground
    let pageSize: PageSize

    public init(background: PageBackground, pageSize: PageSize) {
        self.background = background
        self.pageSize = pageSize
    }

    public var body: some View {
        Canvas { context, size in
            let rect = CGRect(origin: .zero, size: size)
            switch background {
            case .template(let template, let paperColorHex):
                context.fill(Path(rect), with: .color(Color(hex: paperColorHex) ?? .white))
                PaperTemplateRenderer(context: context, size: size,
                                      scale: size.width / pageSize.width).draw(template)
            case .pdf:
                // TODO(M3): render the PDF page via NoteboardPDF.
                context.fill(Path(rect), with: .color(.white))
            }
        }
        .accessibilityHidden(true)
    }
}

struct PaperTemplateRenderer {
    let context: GraphicsContext
    let size: CGSize
    let scale: CGFloat

    static let lineColor = Color(red: 0.64, green: 0.76, blue: 0.88)
    static let marginColor = Color(red: 0.93, green: 0.56, blue: 0.56)

    private var lineWidth: CGFloat { max(0.5, 0.75 * scale) }
    private func pt(_ value: CGFloat) -> CGFloat { value * scale }

    func draw(_ template: PaperTemplate) {
        let headerY = pt(72)
        switch template {
        case .blank:
            break
        case .ruled:
            horizontalLines(spacing: pt(26), from: headerY, to: size.height - pt(36))
            line(from: CGPoint(x: pt(72), y: 0), to: CGPoint(x: pt(72), y: size.height), color: Self.marginColor)
        case .narrowRuled:
            horizontalLines(spacing: pt(20), from: headerY, to: size.height - pt(36))
            line(from: CGPoint(x: pt(60), y: 0), to: CGPoint(x: pt(60), y: size.height), color: Self.marginColor)
        case .grid:
            horizontalLines(spacing: pt(20), from: 0, to: size.height)
            verticalLines(spacing: pt(20), from: 0, to: size.height)
        case .dotted:
            dots(spacing: pt(20))
        case .cornell:
            let summaryY = size.height - pt(150)
            horizontalLines(spacing: pt(26), from: headerY, to: summaryY)
            line(from: CGPoint(x: size.width * 0.3, y: headerY), to: CGPoint(x: size.width * 0.3, y: summaryY),
                 color: Self.marginColor)
            line(from: CGPoint(x: 0, y: summaryY), to: CGPoint(x: size.width, y: summaryY),
                 color: Self.marginColor)
        case .planner:
            line(from: CGPoint(x: 0, y: pt(90)), to: CGPoint(x: size.width, y: pt(90)), color: Self.marginColor)
            horizontalLines(spacing: pt(30), from: pt(120), to: size.height - pt(30))
            line(from: CGPoint(x: size.width / 2, y: pt(90)), to: CGPoint(x: size.width / 2, y: size.height),
                 color: Self.lineColor)
        }
    }

    private func line(from start: CGPoint, to end: CGPoint, color: Color) {
        var path = Path()
        path.move(to: start)
        path.addLine(to: end)
        context.stroke(path, with: .color(color), lineWidth: lineWidth)
    }

    private func horizontalLines(spacing: CGFloat, from top: CGFloat, to bottom: CGFloat) {
        guard spacing > 0 else { return }
        var path = Path()
        var y = top
        while y <= bottom {
            path.move(to: CGPoint(x: 0, y: y))
            path.addLine(to: CGPoint(x: size.width, y: y))
            y += spacing
        }
        context.stroke(path, with: .color(Self.lineColor), lineWidth: lineWidth)
    }

    private func verticalLines(spacing: CGFloat, from top: CGFloat, to bottom: CGFloat) {
        guard spacing > 0 else { return }
        var path = Path()
        var x: CGFloat = 0
        while x <= size.width {
            path.move(to: CGPoint(x: x, y: top))
            path.addLine(to: CGPoint(x: x, y: bottom))
            x += spacing
        }
        context.stroke(path, with: .color(Self.lineColor), lineWidth: lineWidth)
    }

    private func dots(spacing: CGFloat) {
        guard spacing > 0 else { return }
        let radius = max(0.75, scale)
        var path = Path()
        var y = spacing
        while y < size.height {
            var x = spacing
            while x < size.width {
                path.addEllipse(in: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2))
                x += spacing
            }
            y += spacing
        }
        context.fill(path, with: .color(Self.lineColor))
    }
}

public extension Color {
    /// Parses "#RRGGBB" / "RRGGBB".
    init?(hex: String) {
        var string = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if string.hasPrefix("#") { string.removeFirst() }
        guard string.count == 6, let value = UInt64(string, radix: 16) else { return nil }
        self.init(red: Double((value >> 16) & 0xFF) / 255,
                  green: Double((value >> 8) & 0xFF) / 255,
                  blue: Double(value & 0xFF) / 255)
    }
}
#endif
