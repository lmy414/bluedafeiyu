import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('editorial_plugin', Path(__file__).with_name('__init__.py'))
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


class PluginTests(unittest.TestCase):
    def test_transport_is_fixed_and_json_uses_stdin(self):
        with patch.object(plugin.subprocess, 'run') as run:
            run.return_value.stdout = b'{"ok":true}'
            run.return_value.returncode = 0
            value = plugin.bridge('draft', {'target': 'admin', 'content': {'name': '$(touch /tmp/unsafe)'}})
            self.assertTrue(value['ok'])
            command = run.call_args.args[0]
            self.assertEqual(command[-2:], ['/usr/local/sbin/dafeiyu-hermes-bridge', 'agent-tool'])
            self.assertNotIn('$(touch /tmp/unsafe)', ' '.join(command))
            self.assertIn('$(touch /tmp/unsafe)', run.call_args.kwargs['input'].decode())

    def test_all_seven_tools_are_registered_with_strict_schemas(self):
        class Context:
            def __init__(self): self.tools = []
            def register_tool(self, **kwargs): self.tools.append(kwargs)
        ctx = Context()
        plugin.register(ctx)
        self.assertEqual(len(ctx.tools), 7)
        self.assertTrue(all(t['toolset'] == 'dafeiyu_editorial' for t in ctx.tools))
        self.assertTrue(all(t['schema']['parameters']['additionalProperties'] is False for t in ctx.tools))

    def test_no_model_client_and_transport_failure_is_not_success(self):
        with patch.object(plugin.subprocess, 'run') as run:
            run.return_value.stdout = b''
            run.return_value.returncode = 255
            self.assertFalse(plugin.bridge('list', {'target': 'submission'})['ok'])
        source = Path(__file__).with_name('__init__.py').read_text(encoding='utf-8')
        for text in ['vision_analyze_tool(', 'chat.completions', 'ctx.llm', 'OpenAI(']:
            self.assertNotIn(text, source)


if __name__ == '__main__': unittest.main()
