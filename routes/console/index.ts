import ConsoleApp from "../../console/src/index.html";
import robotsTxt from "./robots.txt";
import * as hello from "./api/hello";
import helloName from "./api/hello/[name]";

export const routes = {
  '/console/*': ConsoleApp,
  '/console/robots.txt': robotsTxt,
  '/console/api/hello': hello,
  '/console/api/hello/:name': helloName,
};
