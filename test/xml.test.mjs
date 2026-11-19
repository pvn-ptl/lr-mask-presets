import { test } from "node:test";
import assert from "node:assert/strict";
import { XmlError, attr, child, parseXml } from "../web/core/xml.js";

test("namespaces resolve by URI, whatever the prefix", () => {
  const a = parseXml('<a:root xmlns:a="urn:x" a:k="1"><a:kid/></a:root>');
  const b = parseXml('<root xmlns="urn:x" xmlns:q="urn:x" q:k="1"><kid/></root>');
  for (const root of [a, b]) {
    assert.equal(root.uri, "urn:x");
    assert.equal(root.local, "root");
    assert.equal(attr(root, "urn:x", "k"), "1");
    assert.ok(child(root, "urn:x", "kid"));
  }
});

test("unprefixed attributes have no namespace; inner declarations shadow outer ones", () => {
  const root = parseXml('<p:a xmlns:p="urn:one" k="v"><p:b xmlns:p="urn:two"/></p:a>');
  assert.equal(attr(root, "", "k"), "v");
  assert.equal(root.children[0].uri, "urn:two");
});

test("entities, character references, CDATA, comments and processing instructions", () => {
  const root = parseXml('﻿<?xml version="1.0"?><!-- hi --><r a="&lt;&amp;&quot;&#65;&#x42;">x &gt; y<![CDATA[<raw & stuff>]]><?pi skip?></r>');
  assert.equal(attr(root, "", "a"), '<&"AB');
  assert.equal(root.text, "x > y<raw & stuff>");
});

test("single-quoted attributes and whitespace around =", () => {
  const root = parseXml("<r a = 'one' b=\"two\"/>");
  assert.equal(attr(root, "", "a"), "one");
  assert.equal(attr(root, "", "b"), "two");
});

test("rejects DTDs and entity declarations (no billion laughs, no external entities)", () => {
  assert.throws(() => parseXml('<!DOCTYPE r [<!ENTITY a "aaaa">]><r>&a;</r>'), XmlError);
  assert.throws(() => parseXml('<!DOCTYPE r SYSTEM "file:///etc/passwd"><r/>'), XmlError);
});

test("rejects malformed documents", () => {
  for (const bad of ["", "just text", "<a>", "<a></b>", "<a><b></a></b>", "<a x='1' x='2'/>", "<a>&unknown;</a>", "<a/><b/>", "<a x=1/>", "<p:a/>"]) {
    assert.throws(() => parseXml(bad), XmlError, bad);
  }
});

test("rejects absurd nesting depth", () => {
  const deep = "<a>".repeat(1000) + "</a>".repeat(1000);
  assert.throws(() => parseXml(deep), XmlError);
});
