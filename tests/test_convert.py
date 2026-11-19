import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

from lrmask import curves
from lrmask.mapping import APPROX, EXACT, LOST, Options, convert
from lrmask.writer import build_preset, group_name
from lrmask.xmp import CRS, RDF, PresetError, parse_preset

FIXTURES = Path(__file__).with_name("fixtures")


def load(name):
    return parse_preset((FIXTURES / name).read_bytes(), fallback_name=name)


def statuses(conv):
    return {row.label: row.status for row in conv.rows}


class ParseTests(unittest.TestCase):
    def test_reads_attributes_alt_text_and_curves(self):
        preset = load("full_look.xmp")
        self.assertEqual(preset.name, "Moody & Warm")
        self.assertEqual(preset.group, "Test Looks")
        self.assertEqual(preset.settings["Exposure2012"], "+0.50")
        self.assertEqual(preset.curves["ToneCurvePV2012"], [(0, 20), (64, 58), (192, 200), (255, 240)])

    def test_reads_element_values_and_ignores_nested_mask_settings(self):
        preset = load("mono_fade.xmp")
        self.assertEqual(preset.settings["Exposure2012"], "+4.60")
        self.assertEqual(preset.mask_count, 1)
        self.assertNotIn("LocalExposure2012", preset.settings)
        self.assertNotIn("What", preset.settings)

    def test_rejects_dtd(self):
        with self.assertRaises(PresetError):
            parse_preset(b'<!DOCTYPE x [<!ENTITY a "b">]><x/>')

    def test_rejects_non_xmp(self):
        with self.assertRaises(PresetError):
            parse_preset(b"<html><body>hi</body></html>")


class MappingTests(unittest.TestCase):
    def test_slider_scales(self):
        conv = convert(load("full_look.xmp"))
        self.assertAlmostEqual(conv.local["LocalExposure2012"], 0.125)  # +0.50 EV / 4
        self.assertAlmostEqual(conv.local["LocalContrast2012"], 0.20)
        self.assertAlmostEqual(conv.local["LocalHighlights2012"], -0.30)
        self.assertAlmostEqual(conv.local["LocalShadows2012"], 0.40)
        self.assertAlmostEqual(conv.local["LocalTexture"], 0.12)
        self.assertAlmostEqual(conv.local["LocalDehaze"], 0.05)
        self.assertAlmostEqual(conv.local["LocalSaturation"], -0.10)

    def test_color_grading_is_one_to_one(self):
        grade = convert(load("full_look.xmp")).color_grade
        self.assertEqual(grade["LocalColorGradeShadowHue"], 220)
        self.assertEqual(grade["LocalColorGradeShadowSat"], 18)
        self.assertEqual(grade["LocalColorGradeHighlightSat"], 22)
        self.assertEqual(grade["LocalColorGradeMidtoneHue"], 30)
        self.assertEqual(grade["LocalColorGradeBalance"], -10)
        self.assertEqual(grade["LocalColorGradeBlending"], 60)

    def test_curves_pass_through(self):
        conv = convert(load("full_look.xmp"))
        self.assertEqual(conv.curves["MainCurve"], [(0, 20), (64, 58), (192, 200), (255, 240)])
        self.assertEqual(conv.curves["BlueCurve"], [(0, 10), (255, 245)])
        self.assertNotIn("RedCurve", conv.curves)  # identity curves are dropped

    def test_reports_what_cannot_carry_over(self):
        s = statuses(convert(load("full_look.xmp")))
        for label in ("Color Mixer (HSL)", "Vibrance", "White Balance", "Vignette", "Grain"):
            self.assertEqual(s[label], LOST, label)
        self.assertNotIn("Profile", s)  # Adobe Color is the default starting point, not part of the look
        self.assertEqual(s["Exposure"], EXACT)
        self.assertEqual(s["Tone Curve"], EXACT)

    def test_vibrance_option(self):
        conv = convert(load("full_look.xmp"), Options(vibrance=True))
        self.assertAlmostEqual(conv.local["LocalSaturation"], -0.10 + 0.26 * 0.5)
        self.assertEqual(statuses(conv)["Vibrance"], APPROX)

    def test_exposure_is_clamped_to_mask_range(self):
        conv = convert(load("mono_fade.xmp"))
        self.assertEqual(conv.local["LocalExposure2012"], 1.0)
        self.assertEqual(statuses(conv)["Exposure"], APPROX)

    def test_grayscale_and_incremental_white_balance(self):
        conv = convert(load("mono_fade.xmp"))
        self.assertEqual(conv.local["LocalSaturation"], -1.0)
        self.assertAlmostEqual(conv.local["LocalTemperature"], 0.15)
        self.assertAlmostEqual(conv.local["LocalTint"], -0.05)
        s = statuses(conv)
        self.assertEqual(s["Black & White"], APPROX)
        self.assertEqual(s["B&W Mix"], LOST)
        self.assertEqual(s["Existing masks"], LOST)
        self.assertNotIn("White Balance", s)

    def test_grayscale_off(self):
        conv = convert(load("mono_fade.xmp"), Options(grayscale=False))
        self.assertNotIn("LocalSaturation", conv.local)
        self.assertEqual(statuses(conv)["Black & White"], LOST)

    def test_parametric_curve_is_approximated(self):
        conv = convert(load("mono_fade.xmp"))
        main = conv.curves["MainCurve"]
        self.assertEqual(main[0], (0, 0))
        self.assertEqual(main[-1], (255, 255))
        ys = [y for _, y in main]
        self.assertEqual(ys, sorted(ys))
        lookup = dict(main)
        self.assertGreater(lookup[32], 32)    # Shadows +30 lifts the shadows
        self.assertLess(lookup[223], 223)     # Highlights -25 pulls highlights down
        self.assertEqual(statuses(conv)["Parametric curve"], APPROX)

    def test_parametric_off(self):
        conv = convert(load("mono_fade.xmp"), Options(parametric=False))
        self.assertNotIn("MainCurve", conv.curves)
        self.assertEqual(statuses(conv)["Parametric curve"], LOST)


class CurveTests(unittest.TestCase):
    def test_no_parametric_values(self):
        self.assertIsNone(curves.parametric_values({"ParametricShadows": "0"}))

    def test_interpolator_hits_points(self):
        f = curves.interpolator([(0, 20), (64, 58), (192, 200), (255, 240)])
        for x, y in [(0, 20), (64, 58), (192, 200), (255, 240)]:
            self.assertAlmostEqual(f(x), y)

    def test_named_curve_used_when_points_missing(self):
        preset = load("full_look.xmp")
        del preset.curves["ToneCurvePV2012"]
        preset.settings["ToneCurveName2012"] = "Medium Contrast"
        self.assertEqual(convert(preset).curves["MainCurve"], curves.NAMED["Medium Contrast"])

    def test_composed_curve_keeps_point_curve_shape(self):
        point = [(0, 20), (128, 128), (255, 240)]
        main = curves.main_curve(point, ((20, 0, 0, 0), curves.DEFAULT_SPLITS))
        self.assertEqual(main[0], (0, 20))
        self.assertEqual(main[-1], (255, 240))


class WriterTests(unittest.TestCase):
    def build(self, fixture="full_look.xmp", target="background"):
        preset = load(fixture)
        conv = convert(preset)
        text = build_preset(preset, conv, target, group_name(preset, target))
        return preset, text, ET.fromstring(text.encode())

    def correction_and_mask(self, root):
        correction = root.find(f".//{CRS}MaskGroupBasedCorrections/{RDF}Seq/{RDF}li/{RDF}Description")
        mask = correction.find(f"{CRS}CorrectionMasks/{RDF}Seq/{RDF}li")
        return correction, mask

    def test_background_mask_matches_lightroom(self):
        _, _, root = self.build()
        correction, mask = self.correction_and_mask(root)
        self.assertEqual(correction.get(CRS + "LocalExposure2012"), "0.125")
        self.assertEqual(correction.get(CRS + "LocalContrast2012"), "0.2")
        self.assertEqual(correction.get(CRS + "LocalCurveRefineSaturation"), "100")
        self.assertEqual(correction.get(CRS + "LocalColorGradeShadowHue"), "+220")
        self.assertEqual(mask.get(CRS + "What"), "Mask/Image")
        self.assertEqual(mask.get(CRS + "MaskName"), "Background 1")
        self.assertEqual(mask.get(CRS + "MaskSubType"), "0")
        self.assertEqual(mask.get(CRS + "MaskSubCategoryID"), "22")
        self.assertEqual(mask.get(CRS + "MaskInverted"), "false")

    def test_subject_and_sky_masks(self):
        for target, subtype in (("subject", "1"), ("sky", "2")):
            _, _, root = self.build(target=target)
            _, mask = self.correction_and_mask(root)
            self.assertEqual(mask.get(CRS + "MaskSubType"), subtype)
            self.assertIsNone(mask.get(CRS + "MaskSubCategoryID"))

    def test_curves_written_in_mask(self):
        _, text, root = self.build()
        correction, _ = self.correction_and_mask(root)
        points = [li.text for li in correction.find(f"{CRS}MainCurve/{RDF}Seq")]
        self.assertEqual(points, ["0,20", "64,58", "192,200", "255,240"])
        self.assertIsNotNone(correction.find(f"{CRS}BlueCurve"))
        self.assertLess(text.index("<crs:MainCurve>"), text.index("<crs:CorrectionMasks>"))

    def test_round_trip_and_marker(self):
        _, text, _ = self.build()
        again = parse_preset(text.encode())
        self.assertEqual(again.name, "Moody & Warm")
        self.assertEqual(again.group, "Background · Test Looks")
        self.assertEqual(again.mask_count, 1)
        self.assertTrue(again.converted)
        self.assertEqual(again.preset_type, "Normal")
        self.assertNotIn("Exposure2012", again.settings)  # nothing global leaks into the new preset

    def test_ids_are_stable_per_target(self):
        _, first, _ = self.build()
        _, second, _ = self.build()
        _, sky, _ = self.build(target="sky")
        uuid = lambda t: parse_preset(t.encode()).uuid
        self.assertEqual(uuid(first), uuid(second))
        self.assertNotEqual(uuid(first), uuid(sky))
        self.assertRegex(uuid(first), r"^[0-9A-F]{32}$")

    def test_group_template(self):
        preset = load("mono_fade.xmp")
        self.assertEqual(group_name(preset, "background"), "Background · Presets")
        self.assertEqual(group_name(preset, "sky", "My {target}s"), "My Skys")


if __name__ == "__main__":
    unittest.main()
